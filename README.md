# ABAWKA — multilingual toy shop with Telegram order requests

A fast, mobile-first toy store for customers across Europe and Ukraine: 9 languages, 4 currencies, and every order request delivered to the owner's Telegram in seconds.

![demo](docs/demo.png)

## Problem
TODO: a small shop selling across many countries — needs a catalog in many languages and currencies, but takes payment personally after talking to the customer. Off-the-shelf platforms force card checkout and charge monthly fees.

## Solution
TODO: static Astro catalog (9 locales, SEO) → cart → order request → Supabase Edge Function validates and recalculates the total server-side → saved to Postgres → Telegram bot notifies the owner instantly. Admin panel with roles for products, requests, promotions and stats.

## Result
TODO: measurable outcome after launch.

## Tech stack
- Astro, TypeScript
- Supabase (Postgres, RLS, Auth, Storage, Edge Functions)
- Telegram Bot API
- Netlify
- Playwright

## Run it
```bash
cp .env.example .env   # fill in your keys
npm install
npm run dev
```

---
Built by Roman — AI automation & Python developer. Available on Upwork.
