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
      folderData.value = folderData.value ?? []
      console.log('folderData')
      console.log(folderData)

      do {
        const { data: nextFolderData } = await axios.get<OdFolderObject>(`${requestUrl}${isRoot ? '' : ':'}/children`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            ...{
              select: 'id,name,size,file,folder,createdDateTime,lastModifiedDateTime',
              $top: siteConfig.maxItems,
              ...(nextPage ? { $skipToken: nextPage } : {}),
            },
          },
        })
        folderData.value.push(...nextFolderData.value)
        nextPage = nextFolderData['@odata.nextLink']?.match(/&\$skiptoken=(.+)/i)![1]
      } while (nextPage)

      const folderDataDict = folderData.value.reduce((acc, item) => {
        acc[item.name] = item
        return acc
      }, {} as Record<string, (typeof folderData.value)[number]>)
      console.log('folderDataDict')
      console.log(folderDataDict)

      return await serveHandler(
        req,
        res,
        {
          public: '/',
          cleanUrls: false,
          rewrites: [{ source: '*', destination: path }],
        },
        {
          // @ts-ignore
          lstat(lstatPath: PathLike, _: (err: NodeJS.ErrnoException | null, stats: Stats) => void) {
            // parameter callback will be undefined
            console.log(`serve-handler.lstat.path: ${lstatPath}`)
            let stats: Stats
            // Check if is root path
            if (lstatPath === path) {
              stats = {
                atime: new Date(),
                atimeMs: 0,
                birthtime: new Date(),
                birthtimeMs: 0,
                blksize: 0,
                blocks: 0,
                ctime: new Date(),
                ctimeMs: 0,
                dev: 0,
                gid: 0,
                ino: 0,
                mode: 0,
                mtime: new Date(),
                mtimeMs: 0,
                nlink: 0,
                rdev: 0,
                size: 0,
                uid: 0,
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isDirectory: () => true,
                isFIFO: () => false,
                isFile: () => false,
                isSocket: () => false,
                isSymbolicLink: () => false,
              }
            } else {
              const item = folderDataDict[pathPosix.basename(lstatPath.toString())]
              if (!item) return
              stats = {
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
              }
            }
            console.log('serve-handler.lstat.return')
            console.log(stats)
            return stats
          },
          // @ts-ignore
          realpath(_: PathLike, __: (err: NodeJS.ErrnoException | null, resolvedPath: string) => void) {
            // parameter callback will be undefined
            return
          },
          // @ts-ignore
          readdir(_: PathLike, __: (err: NodeJS.ErrnoException | null, files: string[]) => void) {
            // parameter callback will be undefined
            console.log(`serve-handler.readdir.return: ${Object.keys(folderDataDict).join(', ')}`)
            return Object.keys(folderDataDict)
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
