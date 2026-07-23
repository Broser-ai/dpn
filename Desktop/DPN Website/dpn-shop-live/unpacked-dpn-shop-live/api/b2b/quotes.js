var quoteHandler = require('./quote');

module.exports = async function(req, res) {
  return quoteHandler(req, res);
};
