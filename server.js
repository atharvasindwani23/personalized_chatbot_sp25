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
const SURVEY_RANGE   = 'Surveys!A:I';  // timestamp, age, gender, frequency, alcoholType, socialContext, importance, reason, arm
const CHAT_RANGE     = 'Chats!A:C';    // timestamp, user_message, bot_reply

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const surveyLog = path.join(logsDir, 'surveys.log');
const chatLog   = path.join(logsDir, 'chats.log');

// Middleware
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(bodyParser.json());

// 1) Log survey submissions
app.post('/api/log_survey', async (req, res) => {
  const entry = { timestamp: new Date().toISOString(), ...req.body };
  // Append to flat file
  fs.appendFileSync(surveyLog, JSON.stringify(entry) + '\n');
  // Append to Google Sheets
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
  try {
    await appendRow(SPREADSHEET_ID, CHAT_RANGE, [
      entry.timestamp,
      user_message,
      bot_reply
    ]);
  } catch (err) {
    console.error('Error appending chat to Google Sheets:', err);
  }
  res.sendStatus(204);
});

// 3) Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { system, message } = req.body;
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: message }
      ]
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
