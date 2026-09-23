const app = require('../server');
const connectDB = require('../src/config/db');

let databaseConnection;

module.exports = async (req, res) => {
  if (!databaseConnection) {
    databaseConnection = connectDB().catch((error) => {
      databaseConnection = null;
      throw error;
    });
  }

  await databaseConnection;
  return app(req, res);
};