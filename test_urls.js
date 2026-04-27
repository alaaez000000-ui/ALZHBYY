
const axios = require('axios');
async function test() {
  const urls = [
    'https://qurancentral.com/api/v1/reciters',
    'https://qurancentral.com/wp-json/quran/v1/reciters',
    'https://www.everyayah.com/data/Alafasy_128kbps/001001.mp3'
  ];
  for (const url of urls) {
    try {
      const res = await axios.get(url, { timeout: 5000, maxContentLength: 1000 });
      console.log(`PASS: ${url} (Status: ${res.status})`);
    } catch (e) {
      console.log(`FAIL: ${url} (Error: ${e.message})`);
    }
  }
}
test();
