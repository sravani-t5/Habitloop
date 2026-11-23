// Fetches /openapi.json from every running service and writes docs/openapi/*.json + docs/HabitLoop.postman_collection.json
const fs = require('fs'); const path = require('path');
const services = { users: 3001, activities: 3002, challenges: 3003, integrations: 3004, analytics: 3005, recommendations: 3006 };
const host = process.env.HOST || 'http://localhost';
(async () => {
  const folders = [];
  for (const [name, port] of Object.entries(services)) {
    const spec = await (await fetch(`${host}:${port}/api/${name}/openapi.json`)).json();
    fs.writeFileSync(path.join(__dirname, `../docs/openapi/${name}.openapi.json`), JSON.stringify(spec, null, 2));
    const items = [];
    for (const [p, ops] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(ops)) {
      const sec = op.security?.[0] ? Object.keys(op.security[0])[0] : null;
      const header = [{ key: 'Content-Type', value: 'application/json' }];
      if (sec === 'internalKey') header.push({ key: 'x-internal-key', value: '{{internalKey}}' });
      if (sec === 'deviceToken') header.push({ key: 'x-device-token', value: '{{deviceToken}}' });
      const props = op.requestBody?.content['application/json'].schema.properties;
      const sample = props ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.type === 'number' || v.type === 'integer' ? 1 : v.type === 'array' ? [] : 'string'])) : null;
      const url = '{{baseUrl}}' + p.replace(/\{(\w+)\}/g, ':$1');
      const req = { method: method.toUpperCase(), header, url: { raw: url, host: ['{{baseUrl}}'], path: url.replace('{{baseUrl}}/', '').split('/') } };
      if (sec === 'bearerAuth') req.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
      if (sample) req.body = { mode: 'raw', raw: JSON.stringify(sample, null, 2), options: { raw: { language: 'json' } } };
      const item = { name: op.summary, request: req };
      // capture the JWT automatically on login / signup
      if (p.endsWith('/auth/login') || p.endsWith('/auth/signup'))
        item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: ['const j = pm.response.json(); if (j.token) pm.collectionVariables.set("token", j.token);'] } }];
      items.push(item);
    }
    folders.push({ name: `${name} service`, item: items });
  }
  const col = {
    info: { name: 'HabitLoop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'Run "users service > Login" first: the token is saved automatically.' },
    variable: [{ key: 'baseUrl', value: 'http://localhost:8080' }, { key: 'token', value: '' }, { key: 'internalKey', value: 'dev-internal-key' }, { key: 'deviceToken', value: '' }],
    item: folders,
  };
  fs.writeFileSync(path.join(__dirname, '../docs/HabitLoop.postman_collection.json'), JSON.stringify(col, null, 2));
  console.log('wrote', Object.keys(services).length, 'openapi specs + postman collection');
})().catch((e) => { console.error(e); process.exit(1); });
