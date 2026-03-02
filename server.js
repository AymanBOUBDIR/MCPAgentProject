const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Ask Groq ─────────────────────────────────────────────────────────────────
async function askGroq(system, userMessage) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage }
    ],
    max_tokens: 500,
    temperature: 0.1,
  });
  return response.choices[0].message.content.trim();
}

// ─── Get all customers ────────────────────────────────────────────────────────
app.get('/api/customers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('customer_id', { ascending: true });
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Add a new customer ───────────────────────────────────────────────────────
app.post('/api/customers', async (req, res) => {
  const { first_name, last_name, email, phone_number } = req.body;
  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name and email are required' });
  }
  try {
    const { data, error } = await supabase
      .from('customers')
      .insert([{ first_name, last_name, email, phone_number }]);
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update a customer ────────────────────────────────────────────────────────
app.put('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, email, phone_number } = req.body;
  try {
    const { data, error } = await supabase
      .from('customers')
      .update({ first_name, last_name, email, phone_number })
      .eq('customer_id', id);
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Delete a customer ────────────────────────────────────────────────────────
app.delete('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('customers')
      .delete()
      .eq('customer_id', id);
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Natural language → SQL → Supabase ───────────────────────────────────────
app.post('/api/query', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    // Step 1: Generate SQL from natural language
    const sql = await askGroq(
      `You are a PostgreSQL expert. The database has a table called "customers" with these columns:
- customer_id (integer, primary key)
- first_name (text)
- last_name (text)
- email (text)
- phone_number (text)

Respond ONLY with a valid raw PostgreSQL SELECT query. No explanation, no markdown, no backticks, nothing else.`,
      question
    );

    // Step 2: Execute SQL via Supabase
    const { data: rows, error: dbError } = await supabase.rpc('execute_query', { sql_query: sql });

    // Step 3: Generate human-friendly summary
    const summary = await askGroq(
      `You are a helpful data assistant. Given a question and query results, give a short friendly 1-2 sentence answer. Be direct and concise.`,
      `Question: "${question}"\nSQL used: ${sql}\nResults: ${JSON.stringify(rows || [])}\n${dbError ? `DB Error: ${dbError.message}` : ''}`
    );

    res.json({ sql, rows: rows || [], summary, error: dbError?.message || null });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'MCP Copilot API running with Groq' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT} | Model: llama-3.3-70b-versatile`));
