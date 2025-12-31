// 这是一个运行在 Vercel 上的 Node.js Serverless Function
// 建议文件路径: api/feishu.js

let cachedToken = null;
let tokenExpire = 0;

export default async function handler(req, res) {
  // 1. 设置 CORS 头，允许跨域访问
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
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

  console.log(`[Request] Action: ${req.query.action}, Method: ${req.method}`);

  try {
    const { action } = req.query; 
    const body = req.body || {};

    // 优先从环境变量获取密钥
    const appId = process.env.FEISHU_APP_ID || body.app_id;
    const appSecret = process.env.FEISHU_APP_SECRET || body.app_secret;

    // 检查环境变量是否配置
    if (!appId || !appSecret) {
        console.error('[Error] Missing FEISHU_APP_ID or FEISHU_APP_SECRET');
        return res.status(500).json({ 
            code: -1, 
            msg: 'Server Configuration Error: Missing Feishu App Credentials in Vercel Environment Variables.' 
        });
    }

    // 2. 内部工具：获取 Tenant Access Token (带简单缓存)
    const getAccessToken = async () => {
      // 检查缓存是否有效
      if (cachedToken && Date.now() < tokenExpire) {
        // console.log('[Token] Using cached token');
        return cachedToken;
      }
      
      console.log('[Token] Fetching new tenant access token...');
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      
      const data = await response.json();
      if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        tokenExpire = Date.now() + (data.expire * 1000) - 60000; // 提前1分钟过期
        console.log('[Token] Successfully obtained new token');
        return cachedToken;
      }
      
      console.error('[Token Error]', data);
      throw new Error(`Feishu Token Error: ${data.msg}`);
    };

    // 获取 Token
    const token = await getAccessToken();
    
    // 基础参数提取
    const { app_token, table_id, record_id, fields } = body;
    
    // 参数校验
    if (!app_token || !table_id) {
        // get_token 动作除外
        if (action !== 'get_token') {
             throw new Error('Missing app_token or table_id in request body');
        }
    }

    const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records`;

    let fetchUrl = baseUrl;
    let method = 'GET';
    let fetchBody = null;

    // 3. 根据 action 分发请求
    switch (action) {
      case 'get_token':
        return res.status(200).json({ code: 0, tenant_access_token: token, expire: 7200 });

      case 'list_records':
        method = 'GET';
        fetchUrl = `${baseUrl}?page_size=500`; 
        break;

      case 'add_record':
        method = 'POST';
        fetchBody = JSON.stringify({ fields });
        break;

      case 'update_record':
        if (!record_id) throw new Error('Missing record_id for update');
        method = 'PUT';
        fetchUrl = `${baseUrl}/${record_id}`;
        fetchBody = JSON.stringify({ fields });
        break;

      case 'delete_record':
        if (!record_id) throw new Error('Missing record_id for delete');
        method = 'DELETE';
        fetchUrl = `${baseUrl}/${record_id}`;
        break;

      default:
        return res.status(400).json({ code: -1, msg: `Unknown action: ${action}` });
    }

    console.log(`[Feishu API] ${method} ${fetchUrl}`);

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
    
    if (feishuData.code !== 0) {
        console.error('[Feishu API Error Response]', feishuData);
    } else {
        console.log('[Feishu API Success]');
    }
    
    // 5. 返回结果给前端
    res.status(200).json(feishuData);

  } catch (error) {
    console.error('[Proxy Handler Error]', error);
    res.status(500).json({ code: -1, msg: error.message, stack: error.stack });
  }
}