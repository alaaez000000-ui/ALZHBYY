
const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('https://api.qurancentral.com/v1/reciters');
    console.log(JSON.stringify(res.data).substring(0, 1000));
  } catch (e) {
    console.log('Error:', e.message);
  }
}
test();
