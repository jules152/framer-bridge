import { connect } from "framer-api"
import http from "http"
import busboy from "busboy"
import { v2 as cloudinary } from "cloudinary"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const FRAMER_PROJECT_URL = "https://framer.com/projects/Valoricert--5BxZFOBWwXlA9r1bXaaP-9uUaY"
const COLLECTION_ID = "mm8LhCmM0"
const PORT = process.env.PORT || 3000

async function uploadToCloudinary(imageBuffer) {
  const base64Data = imageBuffer.toString("base64")
  const dataUri = `data:image/png;base64,${base64Data}`
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "valoricert"
  })
  return result.secure_url
}

function injectImage(html, imageUrl, title) {
  const imgTag = `<img class="blog-img" src="${imageUrl}" alt="${title}" />`
  return html.replace(/(<\/h1>)/, `$1${imgTag}`)
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers })
    const fields = {}
    let imageBuffer = null

    bb.on("field", (name, val) => {
      fields[name] = val
    })

    bb.on("file", (name, file) => {
      const chunks = []
      file.on("data", chunk => chunks.push(chunk))
      file.on("end", () => {
        imageBuffer = Buffer.concat(chunks)
      })
    })

    bb.on("close", () => resolve({ fields, imageBuffer }))
    bb.on("error", reject)
    req.pipe(bb)
  })
}

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", chunk => body += chunk)
    req.on("end", () => {
      try { resolve(JSON.parse(body)) }
      catch (e) { reject(e) }
    })
  })
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Content-Type", "application/json")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === "GET" && req.url === "/articles") {
    try {
      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      const items = await collection.getItems()
      await framer.disconnect()
      const articles = items.map(item => ({
        id: item.id,
        slug: item.slug,
        title: item.fieldData["fWTTnmR7Y"]?.value || "",
        content: item.fieldData["H4KiIwaFp"]?.value || ""
      }))
      res.writeHead(200)
      res.end(JSON.stringify(articles))
    } catch (err) {
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  if (req.method === "GET" && req.url.startsWith("/articles/")) {
    const slug = req.url.replace("/articles/", "")
    try {
      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      const items = await collection.getItems()
      await framer.disconnect()
      const item = items.find(i => i.slug === slug)
      if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return }
      res.writeHead(200)
      res.end(JSON.stringify({
        id: item.id,
        slug: item.slug,
        title: item.fieldData["fWTTnmR7Y"]?.value || "",
        content: item.fieldData["H4KiIwaFp"]?.value || ""
      }))
    } catch (err) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  if (req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || ""
      let title, slug, content, imageBuffer

      if (contentType.includes("multipart/form-data")) {
        const { fields, imageBuffer: imgBuf } = await parseMultipart(req)
        title = fields.title
        slug = fields.slug
        content = fields.content
        imageBuffer = imgBuf
        console.log("imageBuffer length:", imageBuffer?.length)
        console.log("imageBuffer start:", imageBuffer?.slice(0, 4).toString("hex"))
        
      } else {
        const body = await parseJSON(req)
        title = body.title
        slug = body.slug
        content = body.content
      }

      let finalContent = content

      if (imageBuffer && imageBuffer.length > 0) {
        console.log("Uploading image to Cloudinary...")
        const imageUrl = await uploadToCloudinary(imageBuffer)
        console.log("Cloudinary URL:", imageUrl)
        finalContent = injectImage(content, imageUrl, title)
      }

      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      await collection.addItems([{
        slug,
        fieldData: {
          "fWTTnmR7Y": { type: "string", value: title },
          "H4KiIwaFp": { type: "formattedText", value: finalContent }
        }
      }])
      await framer.publish()
      await framer.disconnect()

      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
