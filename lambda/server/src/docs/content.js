import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ---------------------------------------------------------------------------
// Documentation manifest
// ---------------------------------------------------------------------------

const SECTIONS = [
  { slug: 'user-guide', title: 'User Guide', description: 'Day-to-day usage guide for sales reps', category: 'Getting Started' },
  { slug: 'admin-guide', title: 'Admin Guide', description: 'Configuration and administration', category: 'Getting Started' },
  { slug: 'integration-guide', title: 'Integration Guide', description: 'Technical integration and CSP setup', category: 'Technical' },
  { slug: 'api-reference', title: 'API Reference', description: 'API endpoints and request/response schemas', category: 'Technical' },
  { slug: 'data-dictionary', title: 'Data Dictionary', description: 'Field reference, objects, and picklist values', category: 'Technical' },
  { slug: 'security-whitepaper', title: 'Security & Privacy', description: 'Data privacy architecture and compliance', category: 'Security' },
  { slug: 'release-notes', title: 'Release Notes', description: 'Version history and changelog', category: 'Updates' },
  { slug: 'deployment-guide', title: 'Deployment Guide', description: 'Step-by-step deployment checklist', category: 'Getting Started' }
];

const SECTIONS_MAP = new Map(SECTIONS.map(s => [s.slug, s]));

const DOCS_CONTENT_DIR = path.join(__dirname, '../../docs-content');

// ---------------------------------------------------------------------------
// GET / — Return documentation manifest
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  return res.json({ sections: SECTIONS });
});

// ---------------------------------------------------------------------------
// GET /:slug — Return rendered documentation page
// ---------------------------------------------------------------------------

router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const section = SECTIONS_MAP.get(slug);
    if (!section) {
      return res.status(404).json({ success: false, message: 'Documentation section not found' });
    }

    const filePath = path.join(DOCS_CONTENT_DIR, `${slug}.md`);

    let markdown;
    try {
      markdown = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          message: 'Content for this section is not yet available'
        });
      }
      throw err;
    }

    const html = marked(markdown);

    return res.json({
      slug: section.slug,
      title: section.title,
      content: html,
      category: section.category
    });
  } catch (error) {
    console.error('Error serving doc content:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
