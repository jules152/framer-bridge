import { connect } from "framer-api"
import http from "http"

const FRAMER_PROJECT_URL = "https://framer.com/projects/Valoricert--5BxZFOBWwXlA9r1bXaaP-9uUaY"
const FRAMER_API_KEY = process.env.FRAMER_API_KEY
const PORT = process.env.PORT || 3000
const COLLECTION_ID = "mm8LhCmM0"

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405)
    res.end("Method Not Allowed")
    return
  }

  let body = ""
  req.on("data", chunk => body += chunk)
  req.on("end", async () => {
    try {
      const { title, slug, content } = JSON.parse(body)

      const framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)

      await collection.addItems([{
        slug,
        fieldData: {
          "fWTTnmR7Y": title,   // Title
          "H4KiIwaFp": content  // Content
        }
      }])

      await framer.publish()
      await framer.disconnect()

      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
