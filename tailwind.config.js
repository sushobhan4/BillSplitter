/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bgStart: 'var(--color-bg-start)',
        bgEnd: 'var(--color-bg-end)',
        surface: 'var(--color-surface)',
        surfaceAlt: 'var(--color-surface-alt)',
        surfaceHigh: 'var(--color-surface-high)',
        cardStroke: 'var(--color-card-stroke)',
        textPrimary: 'var(--color-text-primary)',
        textSecondary: 'var(--color-text-secondary)',
        textHint: 'var(--color-text-hint)',
        iconTint: 'var(--color-icon-tint)',
        btnPrimaryBg: 'var(--color-btn-primary-bg)',
        btnPrimaryText: 'var(--color-btn-primary-text)',
        btnSecondaryBg: 'var(--color-btn-secondary-bg)',
        btnSecondaryText: 'var(--color-btn-secondary-text)',
        receiveText: 'var(--color-receive-text)',
        giveText: 'var(--color-give-text)',
        
        // Settlement
        settleCard: 'var(--color-settle-card)',
        settleStroke: 'var(--color-settle-stroke)',
        settlePanel: 'var(--color-settle-panel)',
        settleAccent: 'var(--color-settle-accent)',
        
        // Transfer
        transferCard: 'var(--color-transfer-card)',
        transferStroke: 'var(--color-transfer-stroke)',
        transferPanel: 'var(--color-transfer-panel)',
        transferAccent: 'var(--color-transfer-accent)',
        
        // Carryover
        carryCard: 'var(--color-carry-card)',
        carryStroke: 'var(--color-carry-stroke)',
        carryPanel: 'var(--color-carry-panel)',
        carryAccent: 'var(--color-carry-accent)',
      },
    },
  },
  plugins: [],
}
