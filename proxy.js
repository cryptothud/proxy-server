const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.get('/', (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing URL parameter');
  }

  axios.get(url)
    .then(response => {
      res.json(response.data);
    })
    .catch(error => {
      res.status(500).send(`Error fetching data from ${url}: ${error}`);
    });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});