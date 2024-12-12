import type { NextApiRequest, NextApiResponse } from 'next'
import serveHandler from 'serve-handler'
import { posix as pathPosix } from 'path'
import axios from 'axios'
import { checkAuthRoute, encodePath, getAccessToken } from '../index'
import apiConfig from '../../../../config/api.config'
import siteConfig from '../../../../config/site.config'
import { OdAPIResponse, OdFolderObject } from '../../../types'
import { runCorsMiddleware } from '../raw'
import { PathLike, Stats } from 'fs'
import dayjs from 'dayjs'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathParts = (req.query.path ?? []) as string[]
  const path = pathPosix.resolve('/', ...pathParts)

  const accessToken = await getAccessToken()
  if (!accessToken) {
    res.status(403).json({ error: 'No access token.' })
    return
  }

  const { code, message } = await checkAuthRoute(path, accessToken, req.headers['od-protected-token'] as string)
  if (code !== 200) {
    res.status(code).json({ error: message })
    return
  }
  // If message is empty, then the path is not protected.
  // Conversely, protected routes are not allowed to serve from cache.
  res.setHeader('Cache-Control', message !== '' ? 'no-cache' : apiConfig.cacheControlHeader)

  const requestPath = encodePath(path)
  const requestUrl = `${apiConfig.driveApi}/root${requestPath}`
  const isRoot = requestPath === ''

  try {
    const { data: identityData } = await axios.get<OdAPIResponse>(requestUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        select: 'id,name,size,file,folder,createdDateTime,lastModifiedDateTime,@microsoft.graph.downloadUrl',
      },
    })

    if (identityData.folder) {
      let nextPage = identityData.next
      let folderData = identityData.folder
      while (nextPage) {
        const { data: nextFolderData } = await axios.get<OdFolderObject>(`${requestUrl}${isRoot ? '' : ':'}/children`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            ...{
              select: 'id,name,size,file,folder,createdDateTime,lastModifiedDateTime',
              $top: siteConfig.maxItems,
            },
          },
        })
        folderData.value.push(...nextFolderData.value)

        // Extract next page token from full @odata.nextLink
        nextPage = nextFolderData['@odata.nextLink']?.match(/&\$skiptoken=(.+)/i)![1]
      }
      const folderDataDict = folderData.value.reduce((acc, item) => {
        acc[item.name] = item
        return acc
      }, {} as Record<string, (typeof folderData.value)[number]>)
      return await serveHandler(
        req,
        res,
        {
          cleanUrls: false,
          rewrites: [{ source: '*', destination: path }],
        },
        {
          // @ts-ignore
          lstat(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void) {
            const item = folderDataDict[path.toString()]
            if (!item) return
            return callback(null, {
              atime: dayjs(item.lastModifiedDateTime).toDate(),
              atimeMs: dayjs(item.lastModifiedDateTime).millisecond(),
              birthtime: dayjs(item.createdDateTime).toDate(),
              birthtimeMs: dayjs(item.createdDateTime).millisecond(),
              blksize: 0,
              blocks: 0,
              ctime: dayjs(item.createdDateTime).toDate(),
              ctimeMs: dayjs(item.createdDateTime).millisecond(),
              dev: 0,
              gid: 0,
              ino: 0,
              mode: 0,
              mtime: dayjs(item.lastModifiedDateTime).toDate(),
              mtimeMs: dayjs(item.lastModifiedDateTime).millisecond(),
              nlink: 0,
              rdev: 0,
              size: item.size,
              uid: 0,
              isBlockDevice: () => false,
              isCharacterDevice: () => false,
              isDirectory: () => !!item.folder,
              isFIFO: () => false,
              isFile: () => !!item.file,
              isSocket: () => false,
              isSymbolicLink: () => false,
            })
          },
          // @ts-ignore
          realpath(path: PathLike, callback: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void) {
            return callback(null, pathPosix.resolve('/', path.toString()))
          },
        }
      )
    } else {
      await runCorsMiddleware(req, res)
      res.setHeader('Cache-Control', 'no-cache')

      if (identityData['@microsoft.graph.downloadUrl']) {
        res.redirect(identityData['@microsoft.graph.downloadUrl'])
      } else {
        res.status(404).json({ error: 'No download url found.' })
      }
    }
  } catch (error: any) {
    res.status(error?.response?.code ?? 500).json({ error: error?.response?.data ?? 'Internal server error.' })
  }
}
