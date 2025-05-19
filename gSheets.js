// gSheets.js
import fs from 'fs';
import { google } from 'googleapis';
import path from 'path';

// Path to your downloaded JSON key (ensure file is named 'sheet-creds.json')
const KEYFILE = path.join(process.cwd(), 'sheet-creds.json');
const SCOPES  = ['https://www.googleapis.com/auth/spreadsheets'];

// Debug: confirm key file exists before proceeding
console.log('Looking for service-account key at:', KEYFILE, fs.existsSync(KEYFILE));

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILE,
  scopes: SCOPES
});

export const sheets = google.sheets({ version: 'v4', auth });

/**
 * Append a single row to the given spreadsheet/range.
 * If appending chat logs, consolidate Q/A pairs into single cells.
 * @param {string} spreadsheetId The ID of the spreadsheet.
 * @param {string} range         A1 notation of the target sheet and columns, e.g. 'Chats!A:C'
 * @param {any[]}  values        Array of cell values for the new row.
 */
export async function appendRow(spreadsheetId, range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [values] }
  });
}

/**
 * Append or update a grouped conversation entry.
 * This will try to find the most recent row and add to it instead of new row per message.
 */
export async function appendToLatestChat(spreadsheetId, range, userMessage, botReply) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  const rows = res.data.values || [];
  const lastRow = rows[rows.length - 1] || [];
  const timestamp = new Date().toISOString();

  const newUserMsg = (lastRow[1] || '') + (lastRow[1] ? ' || ' : '') + userMessage;
  const newBotMsg  = (lastRow[2] || '') + (lastRow[2] ? ' || ' : '') + botReply;

  const updated = [lastRow[0] || timestamp, newUserMsg, newBotMsg];

  // overwrite the last row in-place
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Chats!A${rows.length}:C${rows.length}`,
    valueInputOption: 'RAW',
    requestBody: { values: [updated] }
  });
}
