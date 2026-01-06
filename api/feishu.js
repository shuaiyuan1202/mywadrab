// 这是一个运行在 Vercel 上的 Node.js Serverless Function
// 建议文件路径: api/feishu.js

let cachedToken = null;
let tokenExpire = 0;

export default async function handler(req, res) {
  // CORS 设置
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log(`[Request] Action: ${req.query.action}`);

  try {
    // ----------------------------------------------------
    // 1. 环境检查与 Token 获取
    // ----------------------------------------------------
    const { action } = req.query; 
    const body = req.body || {};
    
    // 必须配置 Vercel 环境变量
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;

    if (!appId || !appSecret) {
        return res.status(500).json({ code: -1, msg: 'Server Env Error: Missing FEISHU_APP_ID/SECRET' });
    }

    const getAccessToken = async () => {
      if (cachedToken && Date.now() < tokenExpire) return cachedToken;
      
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      const data = await response.json();
      if (data.code === 0) {
        cachedToken = data.tenant_access_token;
        tokenExpire = Date.now() + (data.expire * 1000) - 60000;
        return cachedToken;
      }
      throw new Error(`Token Error: ${data.msg}`);
    };

    const token = await getAccessToken();

    // ----------------------------------------------------
    // 2. 业务逻辑分发
    // ----------------------------------------------------
    
    // 通用参数
    // 注意：登录时操作的是“账号表”，普通操作是“衣服表”，ID 由前端传入
    const { app_token, table_id, record_id, fields, filter } = body; 
    const baseUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${app_token}/tables/${table_id}/records`;

    switch (action) {
      // --- 新增：用户登录逻辑 ---
      case 'login': {
        const { username, password } = body;
        if (!username || !password) return res.status(400).json({ code: -1, msg: 'Missing credentials' });

        // 1. 在账号表中搜索用户名
        // 飞书筛选语法：CurrentValue.[字段名] = "值"
        const filterStr = `CurrentValue.[name]="${username}"`;
        // 只需获取相关字段
        const searchUrl = `${baseUrl}?filter=${encodeURIComponent(filterStr)}`;
        
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const searchData = await searchRes.json();

        if (searchData.code !== 0 || !searchData.data.items || searchData.data.items.length === 0) {
            return res.json({ code: 404, msg: '用户不存在' });
        }

        const userRecord = searchData.data.items[0];
        const userFields = userRecord.fields;

        // 2. 验证密码和状态
        // 注意：生产环境密码应哈希比对，这里演示为明文比对
        if (String(userFields.password) !== String(password)) {
            return res.json({ code: 401, msg: '密码错误' });
        }
        
        console.log(userFields)
        console.log(userFields.status)
        if (!userFields.status) {
            return res.json({ code: 403, msg: '账号未启用或已被禁用' });
        }

        // 3. 登录成功，返回配置信息和 UserID
        // configuration 字段在飞书中是文本类型，存储 JSON 字符串
        let configData = {};
        try {
            configData = JSON.parse(userFields.configuration || '{}');
        } catch (e) {
            console.error('Config parse error', e);
        }

        return res.json({
            code: 0,
            data: {
                user_id: userRecord.record_id, // 使用飞书行 ID 作为用户 ID
                name: userFields.name,
                config: configData // 下发配置
            }
        });
      }

      // --- 通用 CRUD (带权限过滤) ---
      case 'list_records': {
        // 支持 filter 参数，用于 user_id 过滤
        let url = `${baseUrl}?page_size=500`;
        if (filter) {
            url += `&filter=${encodeURIComponent(filter)}`;
        }
        const listRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.json(await listRes.json());
      }

      case 'add_record': {
        const addRes = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields })
        });
        return res.json(await addRes.json());
      }

      case 'update_record': {
        const updateRes = await fetch(`${baseUrl}/${record_id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields })
        });
        return res.json(await updateRes.json());
      }

      case 'delete_record': {
        const delRes = await fetch(`${baseUrl}/${record_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json(await delRes.json());
      }

      default:
        return res.status(400).json({ code: -1, msg: `Unknown action: ${action}` });
    }

  } catch (error) {
    console.error('[Proxy Error]', error);
    res.status(500).json({ code: -1, msg: error.message });
  }
}