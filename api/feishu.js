// 这是一个运行在 Vercel 上的 Node.js Serverless Function
// 建议文件路径: api/feishu.js

// 缓存 Token 避免频繁请求飞书 (飞书限流)
let cachedToken = null;
let tokenExpire = 0;

export default async function handler(req, res) {
  // 1. 设置跨域支持 (CORS) - 允许前端调用
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 处理 OPTIONS 预检请求 (浏览器自动发出)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log(`[Request In] Method: ${req.method}, Action: ${req.query.action || 'N/A'}`);

  try {
    // ----------------------------------------------------
    // 自检 A: 检查 Node.js 版本 (必须 >= 18)
    // ----------------------------------------------------
    if (typeof fetch === 'undefined') {
      const errorMsg = 'Critical Error: Global "fetch" is not defined. Please verify your Vercel Project Settings -> General -> Node.js Version is set to 18.x or 20.x.';
      console.error(errorMsg);
      return res.status(500).json({ code: -1, msg: errorMsg });
    }

    const { action } = req.query; 
    const body = req.body || {};

    // ----------------------------------------------------
    // 自检 B: 获取环境变量 (App ID / Secret)
    // ----------------------------------------------------
    const appId = process.env.FEISHU_APP_ID || body.app_id;
    const appSecret = process.env.FEISHU_APP_SECRET || body.app_secret;

    if (!appId || !appSecret) {
        console.error(`[Config Error] Missing Credentials. AppID present: ${!!appId}, Secret present: ${!!appSecret}`);
        return res.status(500).json({ 
            code: -1, 
            msg: 'Missing FEISHU_APP_ID or FEISHU_APP_SECRET in Vercel Environment Variables.' 
        });
    }

    // ----------------------------------------------------
    // 工具函数: 获取/刷新飞书 Token
    // ----------------------------------------------------
    const getAccessToken = async () => {
      if (cachedToken && Date.now() < tokenExpire) {
        return cachedToken;
      }
      
      console.log('[Token] Fetching new token...');
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      
      const data = await response.json();
      if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        tokenExpire = Date.now() + (data.expire * 1000) - 120000; 
        return cachedToken;
      } else {
        throw new Error(`Feishu API Error ${data.code}: ${data.msg}`);
      }
    };

    const token = await getAccessToken();
    
    // ----------------------------------------------------
    // 业务逻辑处理
    // ----------------------------------------------------
    const { app_token, table_id, record_id, fields, filter, username, password } = body;
    
    // 校验基础参数 (login 动作除外)
    if (action !== 'get_token' && action !== 'login' && (!app_token || !table_id)) {
         return res.status(400).json({ code: -1, msg: 'Missing app_token or table_id' });
    }

    const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records`;
    let fetchUrl = baseUrl;
    let method = 'GET';
    let fetchBody = null;

    switch (action) {
      case 'get_token':
        return res.status(200).json({ code: 0, tenant_access_token: token, expire: 7200 });

      // --- 核心修复：登录逻辑 ---
      case 'login': {
        if (!username || !password || !app_token || !table_id) {
            return res.status(400).json({ code: -1, msg: 'Login requires username, password, app_token and table_id' });
        }

        // 1. 根据 name 搜索用户
        const filterStr = `CurrentValue.[name]="${username}"`;
        const searchUrl = `${baseUrl}?filter=${encodeURIComponent(filterStr)}`;
        
        const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        const searchData = await searchRes.json();

        if (searchData.code !== 0 || !searchData.data.items || searchData.data.items.length === 0) {
            return res.json({ code: 404, msg: '用户不存在' });
        }

        const userRecord = searchData.data.items[0];
        const userFields = userRecord.fields;

        // 2. 校验密码和状态
        if (String(userFields.password) !== String(password)) {
            return res.json({ code: 401, msg: '密码错误' });
        }
        if (userFields.status !== 'enabled') {
            return res.json({ code: 403, msg: '账号未启用' });
        }

        // 3. 解析配置
        let configData = {};
        try {
            configData = JSON.parse(userFields.configuration || '{}');
        } catch (e) {
            console.error('Config JSON parse error', e);
        }

        // --- 关键修复 ---
        // 优先使用账号表中显式的 'user_id' 字段值
        // 如果表格里没有 user_id 列，才回退到 record_id
        const effectiveUserId = userFields.user_id || userRecord.record_id;

        return res.json({
            code: 0,
            data: {
                user_id: effectiveUserId, // 现在返回的是您表格里填写的 ID
                name: userFields.name,
                config: configData
            }
        });
      }

      case 'list_records':
        method = 'GET';
        // 支持 filter 参数
        fetchUrl = `${baseUrl}?page_size=500`;
        if (filter) {
            fetchUrl += `&filter=${encodeURIComponent(filter)}`;
        }
        break;

      case 'add_record':
        method = 'POST';
        fetchBody = JSON.stringify({ fields });
        break;

      case 'update_record':
        if (!record_id) throw new Error('Missing record_id');
        method = 'PUT';
        fetchUrl = `${baseUrl}/${record_id}`;
        fetchBody = JSON.stringify({ fields });
        break;

      case 'delete_record':
        if (!record_id) throw new Error('Missing record_id');
        method = 'DELETE';
        fetchUrl = `${baseUrl}/${record_id}`;
        break;

      default:
        return res.status(400).json({ code: -1, msg: `Unknown action: ${action}` });
    }

    // 4. 发起飞书请求
    console.log(`[Feishu] ${method} ${fetchUrl}`);
    const feishuRes = await fetch(fetchUrl, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: fetchBody
    });

    const feishuData = await feishuRes.json();
    res.status(200).json(feishuData);

  } catch (error) {
    console.error('[Handler Error]', error);
    res.status(500).json({ code: -1, msg: error.message });
  }
}