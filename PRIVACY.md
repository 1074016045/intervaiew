# Privacy

IntervAIew is local-first, not offline-only in every provider mode.

- **Mock Mode:** makes no external AI requests. Resume, JD, session data, answers, and transcript remain in the local SQLite database.
- **DeepSeek Mode:** sends resume text, job description, target role/company, interview type, difficulty, language, and question count to the configured DeepSeek API only while creating a question plan.
- **OpenAI Mode:** sends the same question-planning data to OpenAI only while creating a question plan.
- Candidate answers and the MVP transcript are stored locally and are not sent to any AI provider.

The default database is `./data/intervaiew.db` on the machine running the app. Individual interviews can be permanently deleted from History or Detail; foreign-key cascade removes questions, transcript items, and action receipts. The application uses no analytics, tracking pixels, remote fonts, cloud database, audio capture, or file upload.

Logs contain operational codes and identifiers only. They do not include API keys, resume/JD/answer/transcript text, prompts, raw provider responses, or reasoning content. Review the privacy terms of an external provider before enabling it.
