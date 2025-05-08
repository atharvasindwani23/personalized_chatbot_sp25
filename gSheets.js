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
 * @param {string} spreadsheetId The ID of the spreadsheet.
 * @param {string} range         A1 notation of the target sheet and columns, e.g. 'Surveys!A:H'
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
