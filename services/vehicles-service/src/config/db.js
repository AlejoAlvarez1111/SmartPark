const mysql = require('mysql2/promise');
const { createDb } = require('@smartpark/shared');
const { database } = require('./index');

module.exports = createDb(mysql, database);
