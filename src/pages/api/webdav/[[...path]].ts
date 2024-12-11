import { posix as pathPosix } from 'path'
import axios from 'axios'
import { NextApiRequest, NextApiResponse } from 'next'

import apiConfig from '../../../../config/api.config'
import { checkAuthRoute, encodePath, getAccessToken } from '..'
import { default as rawFileHandler } from '../raw'

const handlePROPFIND = async (req: NextApiRequest, res: NextApiResponse) => {
  const cleanPath = pathPosix.resolve('/', ...((req.query.path ?? []) as string[]))

  const accessToken = await getAccessToken()
  if (!accessToken) {
    res.status(403).json({ error: 'No access token' })
    return
  }

  // Handle protected routes authentication
  const { code, message } = await checkAuthRoute(cleanPath, accessToken, '')
  // Status code other than 200 means user has not authenticated yet
  if (code !== 200) {
    res.status(code).json({ error: message })
    return
  }
  // If message is empty, then the path is not protected.
  // Conversely, protected routes are not allowed to serve from cache.
  if (message !== '') {
    res.setHeader('Cache-Control', 'no-cache')
  }

  const requestPath = encodePath(cleanPath)
  try {
    const requestUrl = `${apiConfig.driveApi}/root${requestPath}/children`
    const { data } = await axios.get(requestUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        select: 'name,size,id,lastModifiedDateTime,folder,file',
      },
    })

    const xmlResponse = `<?xml version="1.0" encoding="UTF-8" ?>
    <d:multistatus xmlns:d="DAV:">
      ${data.value
        .map((item: any) => {
          const isDir = !!item.folder
          return `
            <d:response>
              <d:href>${encodeURIComponent(`/api/webdav${cleanPath}/${item.name}`)}</d:href>
              <d:propstat>
                <d:prop>
                  <d:displayname>${item.name}</d:displayname>
                  <d:resourcetype>${isDir ? '<d:collection/>' : ''}</d:resourcetype>
                </d:prop>
                <d:status>HTTP/1.1 200 OK</d:status>
              </d:propstat>
            </d:response>`
        })
        .join('')}
    </d:multistatus>`

    res.setHeader('Content-Type', 'application/xml; charset="utf-8"')
    res.status(207).send(xmlResponse)
  } catch (error) {
    res.status(500).json({ error: error })
  }
}

const handleGET = async (req: NextApiRequest, res: NextApiResponse) => {
  req.query = { ...req.query, path: pathPosix.resolve('/', ...((req.query.path ?? []) as string[])) }
  await rawFileHandler(req, res)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      await handlePROPFIND(req, res)
      break
    // case 'GET':
    //   await handleGET(req, res)
    //   break
    default:
      res.status(405).json({ error: 'Method Not Allowed' })
      break
  }
}
