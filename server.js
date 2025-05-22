import express from 'express';
import path from 'path';
import fs from 'fs';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import axios from 'axios';
import { appendRow } from './gSheets.js';

dotenv.config();

const app = express();

// Google Sheets configuration
const SPREADSHEET_ID = '1Nt79kUX0xZSnSWoe8xWEyhQsVUO5UOoIjgQTP9XdPig';
const SURVEY_RANGE   = 'Surveys!A:J'; // includes responseId now
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
  fullHistory: [],
  surveyData: {},
  responseId: null,
  surveyIdWritten: false
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
      req.body.arm,
      '' // placeholder for responseId
    ]);

    // Reset conversation state for new survey
    currentConversation = {
      timestamp: new Date().toISOString(),
      user: [],
      bot: [],
      flushed: false,
      fullHistory: [],
      surveyData: req.body,
      responseId: null,
      surveyIdWritten: false
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

// 3) Chat endpoint using OpenAI Responses API with fallback
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;

  const headers = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const messages = [];
    for (let i = 0; i < currentConversation.user.length; i++) {
      messages.push({ role: 'user', content: currentConversation.user[i] });
      if (currentConversation.bot[i]) {
        messages.push({ role: 'assistant', content: currentConversation.bot[i] });
      }
    }
    messages.push({ role: 'user', content: message });

    const payload = {
      model: 'gpt-4o',
      input: messages,
      max_tokens: 1000,
      temperature: 0.7
    };

    if (currentConversation.responseId) {
      payload.previous_response_id = currentConversation.responseId;
    }

    const response = await axios.post('https://api.openai.com/v1/responses', payload, { headers });

    const reply = response.data.output?.content ||
                  response.data.choices?.[0]?.message?.content ||
                  response.data.response?.message?.content ||
                  "I'm sorry, I couldn't generate a response.";

    if (response.data.id) {
      currentConversation.responseId = response.data.id;
    }

    if (currentConversation.responseId && !currentConversation.surveyIdWritten) {
      try {
        const { google } = await import('googleapis');
        const auth = new google.auth.GoogleAuth({
          keyFile: path.join(process.cwd(), 'sheet-creds.json'),
          scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const sheets = google.sheets({ version: 'v4', auth });
        const get = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: SURVEY_RANGE
        });
        const surveyRow = (get.data.values || []).length;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Surveys!J${surveyRow}:J${surveyRow}`,
          valueInputOption: 'RAW',
          requestBody: { 
            values: [[currentConversation.responseId]] 
          }
        });
        currentConversation.surveyIdWritten = true;
      } catch (err) {
        console.error('Failed to write response ID to sheet:', err);
      }
    }

    return res.json({ reply });

  } catch (err) {
    console.error('OpenAI Responses API error:', err.response?.data || err.message);
    try {
      const fallbackMessages = [
        {
          role: 'system',
          content: `You are a compassionate healthcare chatbot. Here is the user’s survey data:\n${Object.entries(currentConversation.surveyData).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
        },
        ...currentConversation.user.map((text, i) => [
          { role: 'user', content: text },
          currentConversation.bot[i] ? { role: 'assistant', content: currentConversation.bot[i] } : null
        ]).flat().filter(Boolean),
        { role: 'user', content: message }
      ];

      const fallbackPayload = {
        model: 'gpt-4o',
        messages: fallbackMessages,
        max_tokens: 1000,
        temperature: 0.7
      };

      const fallbackResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions', 
        fallbackPayload, 
        { headers }
      );

      const fallbackReply = fallbackResponse.data.choices[0].message.content;
      return res.json({ reply: fallbackReply });

    } catch (fallbackErr) {
      console.error('Fallback API error:', fallbackErr.response?.data || fallbackErr.message);
      return res.status(500).json({ reply: 'Sorry, something went wrong with the chat service.' });
    }
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    conversation: {
      active: currentConversation.user.length > 0,
      messages: currentConversation.user.length,
      responseId: currentConversation.responseId ? 'set' : 'none'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('OpenAI Responses API integration active');
});
