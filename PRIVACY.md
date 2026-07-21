# Privacy

IntervAIew is local-first, not offline-only in every provider mode.

- **Mock planning/text mode:** makes no external AI request.
- **DeepSeek planning:** sends resume, job description, role/company, interview settings, language, and question count to DeepSeek only to create the fixed question plan. DeepSeek never receives voice audio or recorded tracks.
- **OpenAI text planning:** sends the same planning material to OpenAI only while creating the fixed plan.
- **OpenAI Realtime voice:** after required explicit consent, sends microphone audio to OpenAI Realtime and receives interviewer audio plus transcription events. Resume and job-description text are not resent to the Realtime session.
- **Fake Realtime tests:** do not request a microphone or contact OpenAI.

Input transcription may not be word-for-word exact. Only finalized candidate transcription is stored as a voice answer; interim text remains in browser memory. Output transcript is used for live display and never replaces the stored canonical question. Voice transcripts are not used for scoring or evaluation.

Dual-track recording is separately consented, optional, and off by default. When enabled, candidate and interviewer tracks are saved separately. When running locally, SQLite is at `./data/intervaiew.db` and recording files are beneath `./data/recordings` on that machine. When deployed to a remote server, “local storage” means that server's filesystem—not the user's device. Audio is not embedded in TXT/JSON exports and is not uploaded to DeepSeek or third-party storage.

Deleting an asset removes its file and metadata; deleting an interview removes associated recording files and cascades questions, transcripts, attempts, assets, and action receipts. Protect host filesystem access and follow applicable retention requirements.

Logs contain safe operational codes and identifiers only. They exclude permanent and ephemeral credentials, resume/JD/answer/transcript text, prompts, provider payloads/events, raw audio, SDP, ICE credentials, and absolute paths. Review provider privacy terms before enabling external modes.
