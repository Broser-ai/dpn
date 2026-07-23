var invoiceHandler = require('./invoice');

module.exports = async function(req, res) {
  return invoiceHandler(req, res);
};
