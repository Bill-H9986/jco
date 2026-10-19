#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release', 'feed'))
const port = Number(process.env.JCO_UPDATE_PORT || 8787)
const baseSegment = String(process.env.JCO_UPDATE_BASE_PATH || 'updates').replace(/^\/+|\/+$/g, '')
const basePath = `/${baseSegment || 'updates'}`
const types = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
}

const server = http.createServer((request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname)
    if (pathname === basePath) pathname = '/'
    else if (pathname.startsWith(`${basePath}/`)) pathname = pathname.slice(basePath.length)
    const target = path.resolve(root, `.${pathname}`)
    if (target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403).end('forbidden')
      return
    }
    const file = fs.statSync(target).isDirectory() ? path.join(target, 'latest.yml') : target
    response.writeHead(200, {
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': fs.statSync(file).size,
    })
    fs.createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404).end('not found')
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`J.Co update feed: http://127.0.0.1:${port}/  root=${root}`)
})
