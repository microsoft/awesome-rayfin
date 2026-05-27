import type { SlideContent } from '@/services/slideshows';

export interface SampleSlideshow {
  title: string;
  description: string;
  format: 'markdown' | 'html';
  slides: SlideContent[];
}

export const sampleSlideshows: SampleSlideshow[] = [
  {
    title: 'Introduction to Rayfin',
    description: 'A sample slideshow using Markdown slides',
    format: 'markdown',
    slides: [
      {
        content: `# Introduction to Rayfin

**Build full-stack apps on Microsoft Fabric**

Rayfin provides authentication, data, and hosting — all in one platform.`,
        notes: 'Welcome everyone! Today we\'ll walk through Rayfin — a full-stack framework for building apps on Microsoft Fabric.',
      },
      {
        content: `## Key Features

- **Authentication** — Fabric SSO with Entra ID
- **Data Layer** — Type-safe entities with row-level security
- **Static Hosting** — Deploy your frontend to Fabric
- **Local Dev** — Full local development experience with Docker`,
        notes: 'Emphasize that all four pillars work together out of the box. No need to wire up auth or configure a database separately.',
      },
      {
        content: `## Get Started

\`\`\`bash
npm create @microsoft/rayfin@latest my-app
cd my-app
npm run dev
\`\`\`

Visit [localhost:5173](http://localhost:5173) to see your app.`,
        notes: 'Live demo opportunity — run the create command and show the app scaffold.',
      },
      {
        content: `## Data Modeling

Define entities with TC39 decorators:

- \`@entity()\` marks a class as a data entity
- \`@uuid()\`, \`@text()\`, \`@int()\`, \`@boolean()\`, \`@date()\` for fields
- \`@role()\` for access control policies`,
      },
      {
        content: `# Thank You!

**Start building with Rayfin today**

*Questions? Check the docs or ask in the community.*`,
        notes: 'Open the floor for Q&A. Have the docs site ready to share.',
      },
    ],
  },
  {
    title: 'Product Launch 2025',
    description: 'A sample slideshow using HTML slides',
    format: 'html',
    slides: [
      {
        content: `<div style="text-align: center;">
  <h1 style="font-size: 2.5rem; color: #1e40af; margin-bottom: 0.5rem;">🚀 Product Launch 2025</h1>
  <p style="font-size: 1.25rem; color: #6b7280;">Introducing the next generation of our platform</p>
  <div style="margin-top: 2rem; padding: 1rem; background: linear-gradient(135deg, #dbeafe, #e0e7ff); border-radius: 1rem;">
    <p style="font-size: 1.1rem; color: #4338ca; font-weight: 600;">January 15, 2025</p>
  </div>
</div>`,
      },
      {
        content: `<h2 style="color: #1e40af; border-bottom: 3px solid #3b82f6; padding-bottom: 0.5rem;">What's New</h2>
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1.5rem;">
  <div style="padding: 1.5rem; background: #f0fdf4; border-radius: 0.75rem; border-left: 4px solid #22c55e;">
    <h3 style="color: #166534; margin: 0 0 0.5rem 0;">⚡ Performance</h3>
    <p style="color: #374151; margin: 0;">3x faster load times with our new engine</p>
  </div>
  <div style="padding: 1.5rem; background: #eff6ff; border-radius: 0.75rem; border-left: 4px solid #3b82f6;">
    <h3 style="color: #1e40af; margin: 0 0 0.5rem 0;">🔒 Security</h3>
    <p style="color: #374151; margin: 0;">Enterprise-grade authentication built in</p>
  </div>
  <div style="padding: 1.5rem; background: #fdf4ff; border-radius: 0.75rem; border-left: 4px solid #a855f7;">
    <h3 style="color: #7e22ce; margin: 0 0 0.5rem 0;">🎨 Design</h3>
    <p style="color: #374151; margin: 0;">Beautiful new UI components and themes</p>
  </div>
  <div style="padding: 1.5rem; background: #fff7ed; border-radius: 0.75rem; border-left: 4px solid #f97316;">
    <h3 style="color: #c2410c; margin: 0 0 0.5rem 0;">🔌 Integrations</h3>
    <p style="color: #374151; margin: 0;">Connect with 50+ popular services</p>
  </div>
</div>`,
      },
      {
        content: `<h2 style="color: #1e40af;">Roadmap</h2>
<div style="position: relative; padding-left: 2rem; margin-top: 1.5rem;">
  <div style="position: absolute; left: 0.5rem; top: 0; bottom: 0; width: 2px; background: #e5e7eb;"></div>
  <div style="position: relative; margin-bottom: 2rem;">
    <div style="position: absolute; left: -1.75rem; width: 1rem; height: 1rem; background: #22c55e; border-radius: 50%;"></div>
    <h3 style="color: #166534; margin: 0;">Q1 — Foundation</h3>
    <p style="color: #6b7280; margin: 0.25rem 0 0 0;">Core platform and authentication</p>
  </div>
  <div style="position: relative; margin-bottom: 2rem;">
    <div style="position: absolute; left: -1.75rem; width: 1rem; height: 1rem; background: #3b82f6; border-radius: 50%;"></div>
    <h3 style="color: #1e40af; margin: 0;">Q2 — Data Layer</h3>
    <p style="color: #6b7280; margin: 0.25rem 0 0 0;">Type-safe entities and real-time sync</p>
  </div>
  <div style="position: relative; margin-bottom: 2rem;">
    <div style="position: absolute; left: -1.75rem; width: 1rem; height: 1rem; background: #a855f7; border-radius: 50%;"></div>
    <h3 style="color: #7e22ce; margin: 0;">Q3 — Integrations</h3>
    <p style="color: #6b7280; margin: 0.25rem 0 0 0;">Third-party connectors and webhooks</p>
  </div>
  <div style="position: relative;">
    <div style="position: absolute; left: -1.75rem; width: 1rem; height: 1rem; background: #e5e7eb; border-radius: 50%;"></div>
    <h3 style="color: #9ca3af; margin: 0;">Q4 — Scale</h3>
    <p style="color: #6b7280; margin: 0.25rem 0 0 0;">Enterprise features and global deployment</p>
  </div>
</div>`,
      },
      {
        content: `<div style="text-align: center;">
  <h1 style="font-size: 2.5rem; color: #1e40af;">Thank You!</h1>
  <p style="font-size: 1.25rem; color: #6b7280; margin-top: 1rem;">We can't wait for you to try it</p>
  <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: center;">
    <a href="#" style="display: inline-block; padding: 0.75rem 1.5rem; background: #3b82f6; color: white; border-radius: 0.75rem; font-weight: 600; text-decoration: none;">Get Early Access</a>
    <a href="#" style="display: inline-block; padding: 0.75rem 1.5rem; background: #f3f4f6; color: #374151; border-radius: 0.75rem; font-weight: 600; text-decoration: none;">Read the Docs</a>
  </div>
</div>`,
      },
    ],
  },
];
