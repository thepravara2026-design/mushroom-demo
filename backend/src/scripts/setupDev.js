// Setup script that ensures the confirmed column exists in the orders table
// This fixes the error when admin cannot find order confirmed column in schema during payment processing

const { Client } = require('pg');
const logger = require('./utils/logger');

async function ensureConfirmedColumnInOrders() {
  const pgUrl = process.env.SUPABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
  const pgClient = new Client({
    connectionString: pgUrl,
    ssl: !process.env.SUPABASE_URL || pgUrl.includes('localhost') ? false : {
      rejectUnauthorized: false,
    },
  });

  try {
    await pgClient.connect();
    logger.info('[Setup] Connected to database for confirmed column verification');

    // Check if 'confirmed' column exists in orders table
    const columnCheckQuery = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'confirmed';
    `;

    const result = await pgClient.query(columnCheckQuery);

    if (result.rows.length === 0) {
      logger.warn('[Setup] Confirmed column not found in orders table. Adding column...');

      // Add the confirmed column to the orders table with proper default value
      // This allows payment processing to properly query the confirmed status
      await pgClient.query(
        `ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT false NOT NULL`
      );
      logger.info('[Setup] Confirmed column added to orders table');

      // Update existing rows to have a proper confirmed value
      await pgClient.query(
        `UPDATE orders SET confirmed = false WHERE confirmed IS NULL`
      );
      logger.info('[Setup] Existing orders updated with confirmed = false');

    } else {
      logger.info('[Setup] Confirmed column already exists in orders table');

      // Verify the column has the correct data type and constraints
      const columnInfoQuery = `
        SELECT data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'confirmed';
      `;

      const columnInfo = await pgClient.query(columnInfoQuery);

      if (columnInfo.rows.length > 0) {
        const { data_type, is_nullable, column_default } = columnInfo.rows[0];
        logger.info(`[Setup] Confirmed column info: data_type=${data_type}, is_nullable=${is_nullable}, default=${column_default}`);

        // Fix if column is nullable (should be NOT NULL for payment processing)
        if (is_nullable === 'YES') {
          await pgClient.query(
            `ALTER TABLE orders ALTER COLUMN confirmed SET NOT NULL`
          );
          logger.warn('[Setup] Fixed confirmed column to be NOT NULL');
        }

        // Ensure default value is set
        if (!column_default || column_default.includes('false')) {
          await pgClient.query(
            `ALTER TABLE orders ALTER COLUMN confirmed SET DEFAULT false`
          );
          logger.info('[Setup] Fixed confirmed column default to false');
        }
      }
    }

    logger.info('[Setup] Confirmed column structure validated and fixed in orders table');

  } catch (error) {
    logger.error('[Setup] Failed to verify/modify confirmed column:', error.message);
    throw error;
  } finally {
    await pgClient.end();
  }
}

// For backward compatibility, provide both function names
module.exports = {
  setupDevDatabase: ensureConfirmedColumnInOrders,
  ensureConfirmedColumnInOrders,
};