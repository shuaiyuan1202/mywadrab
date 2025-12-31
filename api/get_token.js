// api/get_token.js
export default async function handler(req, res) {
  // 1. 这里是后端环境，放 AppID 和 Secret 是安全的
  // 建议放在 Vercel 的环境变量设置里，不要直接写死在代码里
  const APP_ID = process.env.FEISHU_APP_ID;
  const APP_SECRET = process.env.FEISHU_APP_SECRET;

  try {
    // 2. 向飞书发起请求
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

    // 3. 把飞书的结果转发给你的前端
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch token' });
  }
}