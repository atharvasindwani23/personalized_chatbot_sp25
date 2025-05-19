import express from 'express';
import path from 'path';
import fs from 'fs';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import { appendRow } from './gSheets.js';

dotenv.config();

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Sheets configuration
const SPREADSHEET_ID = '1Nt79kUX0xZSnSWoe8xWEyhQsVUO5UOoIjgQTP9XdPig';
const SURVEY_RANGE   = 'Surveys!A:I';
const CHAT_RANGE     = 'Chats!A:C';

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const surveyLog = path.join(logsDir, 'surveys.log');
const chatLog   = path.join(logsDir, 'chats.log');

// Track conversation per server start
let currentConversation = {
  timestamp: new Date().toISOString(),
  user: [],
  bot: [],
  flushed: false,
  fullHistory: [] // NEW: for GPT memory
};

app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.json());

// 1) Log survey submissions
app.post('/api/log_survey', async (req, res) => {
  const entry = { timestamp: new Date().toISOString(), ...req.body };
  fs.appendFileSync(surveyLog, JSON.stringify(entry) + '\n');
  try {
    await appendRow(SPREADSHEET_ID, SURVEY_RANGE, [
      entry.timestamp,
      req.body.age,
      req.body.gender,
      req.body.frequency,
      req.body.alcoholType,
      req.body.socialContext,
      req.body.importance,
      req.body.reason,
      req.body.arm
    ]);
    currentConversation = {
      timestamp: new Date().toISOString(),
      user: [],
      bot: [],
      flushed: false,
      fullHistory: []
    };
  } catch (err) {
    console.error('Error appending survey to Google Sheets:', err);
  }
  res.sendStatus(204);
});

// 2) Log chat turns
app.post('/api/log_chat', async (req, res) => {
  const { user_message, bot_reply } = req.body;
  const entry = { timestamp: new Date().toISOString(), user_message, bot_reply };
  fs.appendFileSync(chatLog, JSON.stringify(entry) + '\n');

  currentConversation.user.push(user_message);
  currentConversation.bot.push(bot_reply);
  currentConversation.fullHistory.push({ role: 'user', content: user_message });
  currentConversation.fullHistory.push({ role: 'assistant', content: bot_reply });

  try {
    if (!currentConversation.flushed) {
      await appendRow(SPREADSHEET_ID, CHAT_RANGE, [
        currentConversation.timestamp,
        currentConversation.user.join("\n"),
        currentConversation.bot.join("\n")
      ]);
      currentConversation.flushed = true;
    } else {
      const { google } = await import('googleapis');
      const auth = new google.auth.GoogleAuth({
        keyFile: path.join(process.cwd(), 'sheet-creds.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const sheets = google.sheets({ version: 'v4', auth });
      const get = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: CHAT_RANGE
      });
      const rowIndex = (get.data.values || []).length;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Chats!A${rowIndex}:C${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            currentConversation.timestamp,
            currentConversation.user.join("\n"),
            currentConversation.bot.join("\n")
          ]]
        }
      });
    }
  } catch (err) {
    console.error('Error appending chat to Google Sheets:', err);
  }
  res.sendStatus(204);
});

// 3) Chat endpoint with memory
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  const messages = [
    { role: 'system', content: 'You are a compassionate healthcare chatbot. Remember the prior conversation and help the user accordingly.' },
    ...currentConversation.fullHistory,
    { role: 'user', content: message }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });
    const reply = response.choices[0].message.content;
    return res.json({ reply });
  } catch (err) {
    console.error('OpenAI API error:', err);
    return res.status(500).json({ reply: 'Sorry, something went wrong.' });
  }
});

// Start server
app.listen(3000, () => console.log('Server running on http://localhost:3000'));
