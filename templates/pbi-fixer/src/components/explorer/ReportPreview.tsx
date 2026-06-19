// ReportPreview — lightweight canvas that renders a page's visuals as boxes
// positioned by their x/y/width/height, scaled to fit the available width.

import React from 'react';
import { makeStyles, shorthands, Text } from '@fluentui/react-components';
import type { PageInfo } from '@/explorer/types';
import { BORDER_COLOR, ICON_ACCENT, GRAY_COLOR } from '@/explorer/theme';

const useStyles = makeStyles({
  canvas: {
    position: 'relative',
    ...shorthands.border('1px', 'solid', BORDER_COLOR),
    ...shorthands.borderRadius('4px'),
    backgroundColor: '#ffffff',
    backgroundImage:
      'linear-gradient(#f4f4f4 1px, transparent 1px), linear-gradient(90deg, #f4f4f4 1px, transparent 1px)',
    backgroundSize: '20px 20px',
    overflow: 'hidden',
    margin: '0 auto',
  },
  visual: {
    position: 'absolute',
    ...shorthands.border('1px', 'solid', ICON_ACCENT),
    ...shorthands.borderRadius('3px'),
    backgroundColor: `${ICON_ACCENT}14`,
    boxSizing: 'border-box',
    ...shorthands.padding('4px'),
    overflow: 'hidden',
    cursor: 'pointer',
    '&:hover': { backgroundColor: `${ICON_ACCENT}26` },
  },
  visualSelected: {
    backgroundColor: `${ICON_ACCENT}3a`,
    ...shorthands.borderWidth('2px'),
    zIndex: 5,
  },
  visualHidden: { opacity: 0.4, ...shorthands.borderStyle('dashed') },
  caption: { fontSize: '10px', lineHeight: '1.2', color: '#333', userSelect: 'none' },
});

export interface ReportPreviewProps {
  page: PageInfo | null;
  selectedVisual?: string | null;
  onSelectVisual?: (visualName: string) => void;
  maxWidth?: number;
}

export const ReportPreview: React.FC<ReportPreviewProps> = ({
  page,
  selectedVisual,
  onSelectVisual,
  maxWidth = 720,
}) => {
  const styles = useStyles();

  if (!page) {
    return (
      <div style={{ padding: '16px', color: GRAY_COLOR, fontSize: '13px', fontStyle: 'italic' }}>
        Select a page to see the live preview
      </div>
    );
  }

  const pageW = page.width || 1280;
  const pageH = page.height || 720;
  const scale = Math.min(1, maxWidth / pageW);

  return (
    <div
      className={styles.canvas}
      style={{ width: pageW * scale, height: pageH * scale }}
    >
      {Object.entries(page.visuals).map(([vName, v]) => {
        const isSel = vName === selectedVisual;
        const cls = [styles.visual, isSel ? styles.visualSelected : '', v.hidden ? styles.visualHidden : '']
          .filter(Boolean)
          .join(' ');
        const label = (v.title || v.displayType || v.type || 'visual').trim();
        return (
          <div
            key={vName}
            className={cls}
            style={{
              left: v.x * scale,
              top: v.y * scale,
              width: Math.max(8, v.width * scale),
              height: Math.max(8, v.height * scale),
            }}
            onClick={() => onSelectVisual?.(vName)}
            title={label}
          >
            <Text className={styles.caption}>{label}</Text>
          </div>
        );
      })}
      {Object.keys(page.visuals).length === 0 && (
        <div style={{ padding: '16px', color: GRAY_COLOR, fontSize: '12px', fontStyle: 'italic' }}>
          This page has no visuals
        </div>
      )}
    </div>
  );
};
