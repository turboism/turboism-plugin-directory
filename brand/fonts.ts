// Shared build-time typography; every site serves its own font assets.
import { Geist, Geist_Mono, Tinos, Noto_Serif_SC, Noto_Serif_JP } from 'next/font/google';
const sans = Geist({ variable: '--font-sans', subsets: ['latin'], display: 'swap' });
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' });
const latin = Tinos({ variable: '--font-violet-latin', weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap' });
const chinese = Noto_Serif_SC({ variable: '--font-violet-zh', weight: '400', preload: false, display: 'swap' });
const japanese = Noto_Serif_JP({ variable: '--font-violet-ja', weight: '400', preload: false, display: 'swap' });
export const brandFontVariables = `${sans.variable} ${mono.variable} ${latin.variable} ${chinese.variable} ${japanese.variable}`;
