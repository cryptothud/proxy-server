import express, { Express, Request, Response } from 'express';
import cors from 'cors'
import axios from "axios";
import rateLimit from "express-rate-limit"
import slowDown from "express-slow-down"

const app = express();
const port = process.env.PORT || 3006;

app.use(cors());

const getIP = request =>
  request.ip ||
  request.headers['x-forwarded-for'] ||
  request.headers['x-real-ip'] ||
  request.connection.remoteAddress

const getRateLimitMiddlewares = ({
  limit = 5000,
  windowMs = 60 * 1000,
  delayAfter = Math.round(10 / 2),
  delayMs = 500,
} = {}) => [
    slowDown({ keyGenerator: getIP, windowMs, delayAfter, delayMs }),
    rateLimit({ keyGenerator: getIP, windowMs, max: limit }),
  ]


const applyMiddleware = middleware => (request, response) =>
  new Promise((resolve, reject) => {
    middleware(request, response, result =>
      result instanceof Error ? reject(result) : resolve(result)
    )
  })


export const middlewares = getRateLimitMiddlewares().map(applyMiddleware)

app.get('/', async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing URL parameter');
  }

  try {
    const fetchedData = await axios.get(url.toString())
    return res.status(200).json(fetchedData?.data)
  } catch (e) {
    await wait(2000)
    try {
      const fetchedData = await axios.get(url.toString())
      return res.status(200).json(fetchedData?.data)
    } catch (e) {
      return res.status(500).json(`Error fetching data from ${url}: ${e.toString()}`);
    }
  }

});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

const wait = (ms: any) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}