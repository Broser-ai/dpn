var cors = require('../_cors');

module.exports = async function(req, res) {
  if (cors.handlePreflight(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    name: 'DPN B2B Portal',
    status: 'online',
    routes: {
      login: '/api/b2b/login',
      register: '/api/b2b/register',
      catalog: '/api/b2b/catalog',
      pricing: '/api/b2b/pricing',
      quotes: '/api/b2b/quotes',
      orders: '/api/b2b/orders',
      invoices: '/api/b2b/invoices',
      procurement: '/api/b2b/procurement'
    },
    ui: '/b2b-portal.html'
  });
};
