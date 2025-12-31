// api/get_token.js

export default async function handler(req, res) {
  // ============================================================
  // 1. 设置 CORS 允许跨域 (这就是那张“欢迎光临”的告示)
  // ============================================================
  res.setHeader('Access-Control-Allow-Credentials', true);
  // '*' 代表允许任何网站访问 (包括 localhost 和 Gemini Canvas)
  // 为了安全，上线后可以将 '*' 改为你的具体域名
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // ============================================================
  // 2. 处理预检请求 (浏览器在发 POST 前会先发一个 OPTIONS 请求问路)
  // ============================================================
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // ============================================================
  // 3. 你的原有业务逻辑 (获取飞书 Token)
  // ============================================================
  const APP_ID = process.env.FEISHU_APP_ID;
  const APP_SECRET = process.env.FEISHU_APP_SECRET;

  try {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "app_id": APP_ID,
        "app_secret": APP_SECRET
      })
    });

    const data = await response.json();
    res.status(200).json(data);
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
}