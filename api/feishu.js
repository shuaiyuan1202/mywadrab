// 这是一个运行在 Vercel 上的 Node.js Serverless Function
// 建议文件路径: api/feishu.js

let cachedToken = null;
let tokenExpire = 0;

export default async function handler(req, res) {
  // 1. 设置 CORS 头，允许跨域访问
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // 生产环境建议替换为您的具体域名
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { action } = req.query; // 从 URL 获取操作类型
    const body = req.body || {};

    // 优先从环境变量获取密钥，也可以从请求体获取（不推荐）
    const appId = process.env.FEISHU_APP_ID || body.app_id;
    const appSecret = process.env.FEISHU_APP_SECRET || body.app_secret;

    if (!appId || !appSecret) {
        // 如果只是简单的 CRUD 操作且 Token 已在内部处理，这里可以放宽，
        // 但获取 Token 必须需要 ID 和 Secret
        if (action === 'get_token' || !cachedToken) {
             return res.status(500).json({ code: -1, msg: 'Missing FEISHU_APP_ID or FEISHU_APP_SECRET in Vercel Env' });
        }
    }

    // 2. 内部工具：获取 Tenant Access Token (带简单缓存)
    const getAccessToken = async () => {
      if (cachedToken && Date.now() < tokenExpire) {
        return cachedToken;
      }
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      const data = await response.json();
      if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        tokenExpire = Date.now() + (data.expire * 1000) - 60000; // 提前1分钟过期
        return cachedToken;
      }
      throw new Error(`Token Error: ${data.msg}`);
    };

    // 获取 Token
    const token = await getAccessToken();
    
    // 基础参数提取
    const { app_token, table_id, record_id, fields } = body;
    const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records`;

    let fetchUrl = baseUrl;
    let method = 'GET';
    let fetchBody = null;

    // 3. 根据 action 分发请求
    switch (action) {
      case 'get_token':
        // 仅返回 Token (用于调试或特殊用途)
        return res.status(200).json({ code: 0, tenant_access_token: token });

      case 'list_records':
        // 获取记录列表
        method = 'GET';
        // 可以增加 filter 参数处理分页，这里暂时获取默认列表
        fetchUrl = `${baseUrl}?page_size=500`; 
        break;

      case 'add_record':
        // 新增记录
        method = 'POST';
        fetchBody = JSON.stringify({ fields });
        break;

      case 'update_record':
        // 更新记录
        if (!record_id) throw new Error('Missing record_id');
        method = 'PUT';
        fetchUrl = `${baseUrl}/${record_id}`;
        fetchBody = JSON.stringify({ fields });
        break;

      case 'delete_record':
        // 删除记录
        if (!record_id) throw new Error('Missing record_id');
        method = 'DELETE';
        fetchUrl = `${baseUrl}/${record_id}`;
        break;

      default:
        return res.status(400).json({ code: -1, msg: 'Unknown action' });
    }

    // 4. 发起飞书请求
    const feishuRes = await fetch(fetchUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: fetchBody
    });

    const feishuData = await feishuRes.json();
    
    // 5. 返回结果给前端
    res.status(200).json(feishuData);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ code: -1, msg: error.message });
  }
}