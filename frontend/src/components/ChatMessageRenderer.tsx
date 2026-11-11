'use client';

import React, { useState, useEffect } from 'react';
import { 
  Sparkles, Maximize2, Download, Copy, Check, ExternalLink, 
  RefreshCw, AlertCircle, X, Image as ImageIcon, Code2
} from 'lucide-react';

export interface ImagePreviewData {
  url: string;
  alt: string;
}

export interface ChatMessageRendererProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  onOpenImage?: (data: ImagePreviewData) => void;
  flash?: (msg: string) => void;
}

interface MessageBlock {
  type: 'text' | 'image' | 'code';
  content: string;
  url?: string;
  alt?: string;
  language?: string;
}

// Helper to download image with CORS fallback and smart filename extraction
export async function downloadImage(url: string, alt: string, flash?: (msg: string) => void) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;

    let filename = 'imagem_ia.png';
    try {
      const urlPath = new URL(url).pathname;
      const base = urlPath.split('/').filter(Boolean).pop();
      if (base && /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(base)) {
        filename = base;
      } else if (alt) {
        filename = `${alt.toLowerCase().replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)}.png`;
      }
    } catch {
      if (alt) {
        filename = `${alt.toLowerCase().replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40)}.png`;
      }
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
    flash?.('Download da imagem iniciado!');
  } catch {
    // If CORS blocks direct fetch download, open in new window
    window.open(url, '_blank');
  }
}

// Parses full message content into blocks (code, images, formatted text)
export function parseMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  if (!content) return blocks;

  // 1. Split by fenced code blocks: ```lang\ncode```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      blocks.push(...parseTextAndImages(textBefore));
    }
    blocks.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const textRemaining = content.substring(lastIndex);
    blocks.push(...parseTextAndImages(textRemaining));
  }

  return blocks;
}

// Parses text segments looking for markdown images ![alt](url) and standalone image URLs
function parseTextAndImages(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  // Match markdown images: ![alt](url) OR standalone image URLs (ending in extension or in /imagens/ path)
  const combinedRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)|(?:^|\s)(https?:\/\/[^\s]+(?:\.(?:png|jpg|jpeg|webp|gif|svg)|\/imagens\/[^\s]+)(?:\?[^\s\)]*)?)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedRegex.exec(text)) !== null) {
    const matchStart = match.index + (match[0].startsWith(' ') ? 1 : 0);
    if (matchStart > lastIndex) {
      const textBefore = text.substring(lastIndex, matchStart);
      if (textBefore) {
        blocks.push({ type: 'text', content: textBefore });
      }
    }

    if (match[2]) {
      // Markdown image: ![alt](url)
      blocks.push({
        type: 'image',
        alt: match[1] || 'Imagem gerada por IA',
        url: match[2],
        content: match[0],
      });
    } else if (match[3]) {
      // Standalone image URL
      const cleanUrl = match[3].replace(/[.,;]+$/, '');
      blocks.push({
        type: 'image',
        alt: 'Imagem gerada por IA',
        url: cleanUrl,
        content: cleanUrl,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const textRemaining = text.substring(lastIndex);
    if (textRemaining) {
      blocks.push({ type: 'text', content: textRemaining });
    }
  }

  return blocks;
}

// Renders an image card with zoom trigger, action buttons, loading & error states
export function ImageCard({
  url,
  alt,
  onOpenLightbox,
  flash,
}: {
  url: string;
  alt: string;
  onOpenLightbox?: (data: ImagePreviewData) => void;
  flash?: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    flash?.('URL da imagem copiada!');
  };

  const handleDownloadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadImage(url, alt, flash);
  };

  return (
    <div className="my-2.5 rounded-xl overflow-hidden border border-white/10 bg-[#0C0C0F] shadow-xl max-w-lg w-full">
      {/* Image Area */}
      <div 
        className="relative group cursor-pointer bg-black/40 min-h-[180px] flex items-center justify-center overflow-hidden"
        onClick={() => !hasError && onOpenLightbox?.({ url, alt })}
      >
        {loading && !hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0C0C0F]/90 text-[#8A8A93]">
            <RefreshCw className="w-5 h-5 animate-spin text-[#C77DFF]" />
            <span className="text-[11px] font-mono">Carregando imagem gerada...</span>
          </div>
        )}

        {hasError ? (
          <div className="p-4 flex flex-col items-center justify-center text-center gap-2 w-full">
            <AlertCircle className="w-6 h-6 text-amber-400" />
            <p className="text-[12px] font-medium text-[#EDEDED]">Falha ao carregar imagem</p>
            <p className="text-[10px] text-[#8A8A93] font-mono break-all max-w-xs">{url}</p>
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="mt-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-mono flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3 h-3" /> Abrir link diretamente
            </a>
          </div>
        ) : (
          <>
            <img
              src={url}
              alt={alt}
              loading="lazy"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setHasError(true);
              }}
              className={`w-full max-h-[420px] object-contain transition-all duration-300 group-hover:scale-[1.01] ${loading ? 'opacity-0' : 'opacity-100'}`}
            />
            {/* Hover overlay hint */}
            {!loading && (
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                <span className="px-3 py-1.5 rounded-full bg-black/75 backdrop-blur-md text-white text-[11px] font-medium flex items-center gap-1.5 shadow-xl border border-white/10">
                  <Maximize2 className="w-3.5 h-3.5 text-[#C77DFF]" /> Clique para expandir
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Caption & Actions Footer */}
      <div className="px-3.5 py-2 border-t border-white/[0.08] bg-[#121216] flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Sparkles className="w-3.5 h-3.5 text-[#C77DFF] shrink-0" />
          <span className="text-[11px] font-mono text-[#D4D4D8] truncate" title={alt}>
            {alt || 'Imagem gerada por IA'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleCopyUrl}
            title="Copiar URL da imagem"
            className="p-1.5 rounded-md hover:bg-white/10 text-[#8A8A93] hover:text-white transition cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#4BFF8F]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownloadClick}
            title="Baixar imagem"
            className="p-1.5 rounded-md hover:bg-white/10 text-[#8A8A93] hover:text-white transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir em nova aba"
            onClick={e => e.stopPropagation()}
            className="p-1.5 rounded-md hover:bg-white/10 text-[#8A8A93] hover:text-white transition cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

// Renders formatted code block with copy button
export function CodeBlockCard({
  code,
  language,
  flash,
}: {
  code: string;
  language: string;
  flash?: (msg: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    flash?.('Código copiado!');
  };

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-white/10 bg-[#0C0C0F] text-[#E4E4E7] font-mono text-[12px] max-w-full">
      <div className="px-3 py-1.5 bg-white/[0.04] border-b border-white/[0.08] flex items-center justify-between">
        <span className="text-[10px] text-[#8A8A93] uppercase font-semibold flex items-center gap-1.5">
          <Code2 className="w-3 h-3 text-[#5B8CFF]" /> {language || 'código'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-[#8A8A93] hover:text-white transition cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-[#4BFF8F]" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// Renders paragraph lines with bold, inline code and markdown links
function FormattedParagraph({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="leading-relaxed">
      {lines.map((line, lIdx) => (
        <React.Fragment key={lIdx}>
          {lIdx > 0 && <br />}
          {renderInlineTokens(line)}
        </React.Fragment>
      ))}
    </div>
  );
}

function renderInlineTokens(line: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      elements.push(<span key={key++}>{line.substring(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      elements.push(
        <code key={key++} className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[#4BFF8F] font-mono text-[11.5px]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      elements.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (match[2] && match[3]) {
      elements.push(
        <a
          key={key++}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#85B7EB] hover:underline inline-flex items-center gap-0.5"
        >
          {match[2]} <ExternalLink className="w-2.5 h-2.5 inline" />
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    elements.push(<span key={key++}>{line.substring(lastIndex)}</span>);
  }

  return elements;
}

// Main message content dispatcher
export function ChatMessageContent({
  content,
  role,
  onOpenImage,
  flash,
}: ChatMessageRendererProps) {
  if (!content) {
    return (
      <span className="flex items-center gap-1.5 text-[#8A8A93] italic font-mono text-[11.5px]">
        <RefreshCw className="w-3 h-3 animate-spin text-[#4BFF8F]" /> Pensando e gerando resposta...
      </span>
    );
  }

  if (role === 'user') {
    return <div className="whitespace-pre-wrap">{content}</div>;
  }

  const blocks = parseMessageBlocks(content);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, idx) => {
        if (block.type === 'image' && block.url) {
          return (
            <ImageCard
              key={idx}
              url={block.url}
              alt={block.alt || 'Imagem gerada por IA'}
              onOpenLightbox={onOpenImage}
              flash={flash}
            />
          );
        }
        if (block.type === 'code') {
          return (
            <CodeBlockCard
              key={idx}
              code={block.content}
              language={block.language || 'text'}
              flash={flash}
            />
          );
        }
        return <FormattedParagraph key={idx} text={block.content} />;
      })}
    </div>
  );
}

// Fullscreen Lightbox Modal for zooming in on generated images
export function ImageLightboxModal({
  image,
  onClose,
  flash,
}: {
  image: ImagePreviewData | null;
  onClose: () => void;
  flash?: (msg: string) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!image) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Lightbox Header */}
      <div 
        className="w-full max-w-4xl flex items-center justify-between mb-3 text-white"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-[#C77DFF] shrink-0" />
          <span className="text-[13px] font-mono text-[#E4E4E7] truncate max-w-lg">
            {image.alt || 'Visualizador de Imagem'}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[#A1A1AA] hover:text-white transition cursor-pointer"
          title="Fechar (ESC)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image Container */}
      <div 
        className="relative max-w-4xl max-h-[75vh] flex items-center justify-center"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={image.url}
          alt={image.alt}
          className="max-w-full max-h-[75vh] object-contain rounded-xl border border-white/10 shadow-2xl bg-black/60"
        />
      </div>

      {/* Lightbox Actions */}
      <div 
        className="mt-3.5 flex items-center gap-2 flex-wrap justify-center"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => {
            navigator.clipboard.writeText(image.url);
            flash?.('Link da imagem copiado!');
          }}
          className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] flex items-center gap-1.5 font-medium transition cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" /> Copiar Link
        </button>
        <button
          onClick={() => downloadImage(image.url, image.alt, flash)}
          className="px-4 py-1.5 rounded-lg bg-[#C77DFF] hover:bg-[#B55FE6] text-black text-[12px] flex items-center gap-1.5 font-semibold transition cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" /> Baixar Imagem
        </button>
        <a
          href={image.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[12px] flex items-center gap-1.5 font-medium transition cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Abrir Original
        </a>
      </div>
    </div>
  );
}
