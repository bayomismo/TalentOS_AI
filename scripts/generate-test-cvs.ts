import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

mkdirSync('test-fixtures/cvs', { recursive: true })

const CV1 = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 14px; color: #444; font-weight: 500; margin: 4px 0 16px; }
  h3 { font-size: 12px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 20px; }
  p, li { font-size: 11px; color: #222; }
  .contact { font-size: 10px; color: #555; }
  .role { font-size: 12px; font-weight: 600; }
  .meta { font-size: 10px; color: #777; }
</style>
</head>
<body>
  <h1>Sarah Martinez</h1>
  <h2>Senior Frontend Engineer</h2>
  <p class="contact">Email: sarah.martinez@example.com &middot; Phone: +1-415-555-0142 &middot; San Francisco, CA &middot; LinkedIn: linkedin.com/in/sarahmartinez</p>

  <h3>Professional Summary</h3>
  <p>Senior frontend engineer with 8 years of experience building production-grade React and TypeScript applications. Led the UI architecture migration at two Series B startups. Comfortable across the stack: React, Next.js, GraphQL, Node.js, and design systems. Strong opinions on accessibility, performance, and shipping velocity.</p>

  <h3>Work Experience</h3>
  <p class="role">Senior Frontend Engineer @ Stripe</p>
  <p class="meta">San Francisco, CA &middot; July 2020 &ndash; Present</p>
  <ul>
    <li>Led migration of internal dashboards from a legacy class-based React app to Next.js + TypeScript, cutting page-load time by 38%.</li>
    <li>Built the design-system primitives used by 11 product teams; owned the accessibility audit program (WCAG 2.1 AA).</li>
    <li>Mentored 4 junior engineers; ran the team's frontend interview loop for 18 months.</li>
  </ul>

  <p class="role">Frontend Engineer @ Shopify</p>
  <p class="meta">Ottawa, ON (Remote) &middot; March 2017 &ndash; June 2020</p>
  <ul>
    <li>Shipped the merchant analytics dashboard (React, GraphQL, Apollo); served ~250k MAUs.</li>
    <li>Owned the CSS-in-JS to Tailwind migration; reduced CSS bundle size by 60%.</li>
    <li>Contributed to the Polaris component library (15+ components shipped).</li>
  </ul>

  <p class="role">Software Engineer @ Hootsuite</p>
  <p class="meta">Vancouver, BC &middot; September 2015 &ndash; February 2017</p>
  <ul>
    <li>Built internal tools in React and Angular; introduced Jest to the frontend team.</li>
  </ul>

  <h3>Education</h3>
  <p>Bachelor of Science in Computer Science &middot; University of British Columbia &middot; 2011 &ndash; 2015</p>

  <h3>Skills</h3>
  <p>React, TypeScript, Next.js, JavaScript, GraphQL, Apollo, Node.js, Tailwind CSS, Jest, Playwright, Webpack, Vite, Figma, Accessibility (WCAG), Design Systems, Mentorship</p>
</body>
</html>
`

const CV2 = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: Helvetica, Arial, sans-serif; padding: 40px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 14px; color: #444; font-weight: 500; margin: 4px 0 16px; }
  h3 { font-size: 12px; text-transform: uppercase; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 20px; }
  p, li { font-size: 11px; color: #222; }
  .contact { font-size: 10px; color: #555; }
  .role { font-size: 12px; font-weight: 600; }
  .meta { font-size: 10px; color: #777; }
</style>
</head>
<body>
  <h1>Priya Nair</h1>
  <h2>Data Scientist</h2>
  <p class="contact">Email: priya.nair@example.com &middot; Phone: +1-650-555-0173 &middot; Mountain View, CA &middot; LinkedIn: linkedin.com/in/priyanair</p>

  <h3>Professional Summary</h3>
  <p>Data scientist with 4 years of experience building machine-learning pipelines for product analytics and experimentation. Comfortable with Python, SQL, and PySpark. Background in causal inference and A/B testing. Looking to grow into a more senior role with more product and stakeholder ownership.</p>

  <h3>Work Experience</h3>
  <p class="role">Data Scientist @ Airbnb</p>
  <p class="meta">San Francisco, CA &middot; August 2021 &ndash; Present</p>
  <ul>
    <li>Built the experimentation platform's CUPAC variance-reduction module (Python, scikit-learn); saved 1.2k hours of compute per quarter.</li>
    <li>Designed A/B tests for the host pricing team; partnered with PMs to ship 3 pricing experiments that lifted bookings 4&ndash;7%.</li>
    <li>Owned the monthly metrics review deck for the search-ranking org.</li>
  </ul>

  <p class="role">Junior Data Analyst @ Uber</p>
  <p class="meta">San Francisco, CA &middot; July 2019 &ndash; July 2021</p>
  <ul>
    <li>Wrote SQL pipelines for the marketplace health dashboard; served 50+ weekly active users.</li>
    <li>Ran root-cause analyses on 4 supply/demand incidents.</li>
  </ul>

  <h3>Education</h3>
  <p>Master of Science in Statistics &middot; Stanford University &middot; 2017 &ndash; 2019</p>
  <p>Bachelor of Science in Mathematics &middot; University of Mumbai &middot; 2013 &ndash; 2017</p>

  <h3>Skills</h3>
  <p>Python, SQL, PySpark, scikit-learn, pandas, NumPy, A/B Testing, Causal Inference, Experimentation, Statistics, Tableau, dbt, Airflow</p>
</body>
</html>
`

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome',
  })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.setContent(CV1, { waitUntil: 'load' })
  await page.pdf({
    path: 'test-fixtures/cvs/sarah-martinez-frontend.pdf',
    format: 'A4',
    printBackground: false,
    margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
  })
  console.log('wrote sarah-martinez-frontend.pdf')

  await page.setContent(CV2, { waitUntil: 'load' })
  await page.pdf({
    path: 'test-fixtures/cvs/priya-nair-data-scientist.pdf',
    format: 'A4',
    printBackground: false,
    margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' },
  })
  console.log('wrote priya-nair-data-scientist.pdf')

  await browser.close()
}
main()
