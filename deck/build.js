/**
 * TrustPay pitch deck.
 *
 * Black / charcoal / white. Typography does the work: thin rules, wide margins,
 * no cards, no gradients, no icons-in-circles. Every number on these slides is
 * measured from the repository or the live deployment; anything illustrative is
 * labelled Example.
 */

const pptx = require('pptxgenjs');
const path = require('path');

const pres = new pptx();
pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5
pres.author = 'TrustPay';
pres.title = 'TrustPay - Trust. Protected.';

/* ------------------------------------------------------------------ tokens */

const INK = '0B0B0C';
const CHAR = '18191C';
const PAPER = 'FFFFFF';
const DIM_D = '9A9AA0'; // secondary text on dark
const DIM_L = '6E6E74'; // secondary text on light
const RULE_D = '303136';
const RULE_L = 'DEDEE1';
const GREEN = '3F8F5F';
const AMBER = 'A8762F';
const F = 'Arial';

const M = 0.85; // page margin
const W = 13.333 - M * 2; // content width

let page = 0;

/** Footer motif: wordmark, section label, page number, hairline. Subtle. */
function frame(slide, dark, label) {
  page += 1;
  const ink = dark ? DIM_D : DIM_L;
  const rule = dark ? RULE_D : RULE_L;

  slide.addShape(pres.ShapeType.line, {
    x: M, y: 6.82, w: W, h: 0,
    line: { color: rule, width: 0.75 },
  });
  slide.addText('TRUSTPAY', {
    x: M, y: 6.9, w: 2.2, h: 0.28,
    fontFace: F, fontSize: 9, bold: true, color: ink, charSpacing: 2, margin: 0,
  });
  if (label) {
    slide.addText(label, {
      x: M + 2.3, y: 6.9, w: 6, h: 0.28,
      fontFace: F, fontSize: 9, color: ink, charSpacing: 1, margin: 0,
    });
  }
  slide.addText(String(page).padStart(2, '0'), {
    x: 13.333 - M - 1, y: 6.9, w: 1, h: 0.28,
    fontFace: F, fontSize: 9, color: ink, align: 'right', margin: 0,
  });
}

function darkSlide(label) {
  const s = pres.addSlide();
  s.background = { color: INK };
  frame(s, true, label);
  return s;
}

function charSlide(label) {
  const s = pres.addSlide();
  s.background = { color: CHAR };
  frame(s, true, label);
  return s;
}

function lightSlide(label) {
  const s = pres.addSlide();
  s.background = { color: PAPER };
  frame(s, false, label);
  return s;
}

function title(slide, text, dark, y = 0.85, size = 34) {
  slide.addText(text, {
    x: M, y, w: W - 1.4, h: 1.15,
    fontFace: F, fontSize: size, bold: true,
    color: dark ? PAPER : INK,
    lineSpacing: size * 1.16, margin: 0, valign: 'top',
  });
}

/** A vertical flow: label rows joined by thin arrows. */
function vFlow(slide, items, opts) {
  const { x, y, w, dark, gap = 0.62, size = 13, align = 'center' } = opts;
  let cy = y;
  items.forEach((item, i) => {
    const strong = item.strong !== false;
    slide.addText(item.t, {
      x, y: cy, w, h: 0.32,
      fontFace: F, fontSize: size, bold: strong,
      color: item.color || (dark ? PAPER : INK),
      align, margin: 0, charSpacing: 0.6,
    });
    if (item.s) {
      slide.addText(item.s, {
        x, y: cy + 0.3, w, h: 0.26,
        fontFace: F, fontSize: 10.5, color: dark ? DIM_D : DIM_L,
        align, margin: 0,
      });
    }
    if (i < items.length - 1) {
      const ax = align === 'center' ? x + w / 2 : x + 0.06;
      slide.addShape(pres.ShapeType.line, {
        x: ax, y: cy + (item.s ? 0.6 : 0.38), w: 0, h: gap - (item.s ? 0.34 : 0.12),
        line: {
          color: dark ? RULE_D : RULE_L, width: 1,
          endArrowType: 'triangle',
        },
      });
    }
    cy += gap + (item.s ? 0.24 : 0);
  });
  return cy;
}

/* ---------------------------------------------------------------- 01 cover */

{
  const s = pres.addSlide();
  s.background = { color: INK };
  page += 1;

  s.addImage({
    path: path.join(__dirname, '..', 'mobile', 'assets', 'android-icon-foreground.png'),
    x: M - 0.35, y: 1.85, w: 1.9, h: 1.9,
  });

  s.addText('TRUSTPAY', {
    x: M, y: 3.75, w: 9, h: 0.95,
    fontFace: F, fontSize: 58, bold: true, color: PAPER,
    charSpacing: 6, margin: 0,
  });
  s.addText('Trust. Protected.', {
    x: M, y: 4.68, w: 9, h: 0.45,
    fontFace: F, fontSize: 19, color: DIM_D, charSpacing: 1, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: M, y: 5.35, w: 3.2, h: 0, line: { color: RULE_D, width: 1 },
  });
  s.addText('Milestone-based payments with a built-in trust layer.', {
    x: M, y: 5.55, w: 8.5, h: 0.4,
    fontFace: F, fontSize: 13, color: DIM_D, margin: 0,
  });
  s.addNotes(
    'Open with the tagline, then the one line that matters: TrustPay is a ' +
    'payment system that understands the work the payment is for.',
  );
}

/* -------------------------------------------------------------- 02 problem */

{
  const s = lightSlide('The problem');
  title(s, "Getting paid shouldn't depend on trust alone.", false);

  s.addText('CLIENT', {
    x: M, y: 2.5, w: 4.6, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('"I don’t want to pay before the work is done."', {
    x: M, y: 2.85, w: 4.9, h: 0.9,
    fontFace: F, fontSize: 19, color: INK, lineSpacing: 25, margin: 0,
  });

  s.addText('FREELANCER', {
    x: 7.3, y: 4.15, w: 4.6, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('"I don’t want to finish the work without knowing I’ll get paid."', {
    x: 7.3, y: 4.5, w: 5.1, h: 1.1,
    fontFace: F, fontSize: 19, color: INK, lineSpacing: 25, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: 5.9, y: 3.05, w: 1.2, h: 1.5, line: { color: RULE_L, width: 1 },
  });

  s.addShape(pres.ShapeType.line, {
    x: M, y: 5.95, w: 4.4, h: 0, line: { color: INK, width: 1.5 },
  });
  s.addText(
    'The problem isn’t sending money.\nThe problem is knowing when money should move.',
    {
      x: M, y: 6.1, w: 8.6, h: 0.7,
      fontFace: F, fontSize: 15, bold: true, color: INK, lineSpacing: 21, margin: 0,
    },
  );
  s.addNotes('This is the insight the whole product comes from. Pause here.');
}

/* ------------------------------------------------------------------ 03 gap */

{
  const s = darkSlide('The gap');
  title(s, "Normal payments don't understand the work.", true);

  vFlow(s, [{ t: 'CLIENT' }, { t: 'PAYMENT' }, { t: 'RECEIVER' }], {
    x: M, y: 2.6, w: 3.4, dark: true, gap: 0.85, size: 15,
  });

  s.addShape(pres.ShapeType.line, {
    x: 5.6, y: 2.5, w: 0, h: 3.1, line: { color: RULE_D, width: 0.75 },
  });

  s.addText('What the transfer never carries', {
    x: 6.3, y: 2.5, w: 6, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_D, charSpacing: 1.5, margin: 0,
  });

  const missing = [
    'No milestone',
    'No completion condition',
    'No protected workflow',
    'No structured approval',
    'No clear cancellation mechanism',
  ];
  missing.forEach((m, i) => {
    s.addText(m, {
      x: 6.3, y: 3.05 + i * 0.52, w: 6, h: 0.38,
      fontFace: F, fontSize: 16, color: PAPER, margin: 0,
    });
    s.addShape(pres.ShapeType.line, {
      x: 6.3, y: 3.5 + i * 0.52, w: 5.4, h: 0,
      line: { color: RULE_D, width: 0.75 },
    });
  });
  s.addNotes(
    'A bank transfer is a fact about money. It carries nothing about what the ' +
    'money was for, so every condition lives outside the system.',
  );
}

/* ------------------------------------------------------------- 04 solution */

{
  const s = lightSlide('The solution');
  title(s, 'TrustPay adds a trust layer between both sides.', false);

  const steps = [
    'CLIENT', 'PROJECT', 'MILESTONES', 'PROTECTED FUNDS',
    'WORK', 'APPROVAL', 'PAYMENT RELEASE',
  ];
  const x0 = M;
  const colW = 1.52;
  const pitch = colW + 0.13;
  const PROTECTED_AT = 3;

  steps.forEach((t, i) => {
    const x = x0 + i * pitch;
    s.addText(t, {
      x, y: 2.95, w: colW, h: 0.7,
      fontFace: F, fontSize: 11.5, bold: true, color: INK,
      align: 'center', valign: 'middle', margin: 0, charSpacing: 0.4,
    });
    s.addShape(pres.ShapeType.line, {
      x, y: 3.72, w: colW, h: 0, line: { color: RULE_L, width: 1 },
    });
    if (i < steps.length - 1) {
      s.addShape(pres.ShapeType.line, {
        x: x + colW + 0.01, y: 3.3, w: 0.11, h: 0,
        line: { color: DIM_L, width: 1, endArrowType: 'triangle' },
      });
    }
  });

  // One continuous rule under the protected span, rather than four separate
  // bars that read as arbitrary emphasis.
  const spanX = x0 + PROTECTED_AT * pitch;
  const spanW = (steps.length - PROTECTED_AT) * pitch - 0.13;
  s.addShape(pres.ShapeType.line, {
    x: spanX, y: 3.72, w: spanW, h: 0, line: { color: INK, width: 2 },
  });

  // Centred on the PROTECTED FUNDS column itself, not near it.
  s.addText('The money enters here and stops.', {
    x: spanX - 0.9, y: 3.92, w: colW + 1.8, h: 0.4,
    fontFace: F, fontSize: 10.5, color: DIM_L, align: 'center', margin: 0,
  });


  s.addText(
    'Every step is a state the system knows about. The payment cannot skip one.',
    {
      x: M, y: 5.55, w: 9.5, h: 0.4,
      fontFace: F, fontSize: 15, color: INK, margin: 0,
    },
  );
  s.addNotes('This is the product in one line. Money moves along a state machine.');
}

/* --------------------------------------------------------- 05 how it works */

{
  const s = lightSlide('How it works');
  title(s, 'One project. Clear conditions. Controlled payment.', false);

  s.addText('PROJECT', {
    x: M, y: 2.45, w: 3, h: 0.28,
    fontFace: F, fontSize: 10, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('Website Development', {
    x: M, y: 2.72, w: 5, h: 0.5,
    fontFace: F, fontSize: 25, bold: true, color: INK, margin: 0,
  });
  s.addText('Total  ₹50,000', {
    x: M, y: 3.24, w: 5, h: 0.35,
    fontFace: F, fontSize: 14, color: DIM_L, margin: 0,
  });
  s.addText('Example', {
    x: M, y: 3.62, w: 1.2, h: 0.28,
    fontFace: F, fontSize: 9, bold: true, color: DIM_L, charSpacing: 1.5, margin: 0,
  });

  const ms = [
    ['1', 'UI Design', '₹10,000', 'Released'],
    ['2', 'Development', '₹15,000', 'Protected'],
    ['3', 'Testing', '₹10,000', 'Not funded'],
    ['4', 'Deployment', '₹15,000', 'Not funded'],
  ];
  const bx = 6.05;
  s.addShape(pres.ShapeType.line, {
    x: bx, y: 2.45, w: 0, h: 3.15, line: { color: RULE_L, width: 0.75 },
  });
  ms.forEach((m, i) => {
    const y = 2.45 + i * 0.78;
    s.addText(m[0], {
      x: bx + 0.4, y, w: 0.4, h: 0.4,
      fontFace: F, fontSize: 12, color: DIM_L, margin: 0,
    });
    s.addText(m[1], {
      x: bx + 0.85, y, w: 2.6, h: 0.4,
      fontFace: F, fontSize: 16, bold: true, color: INK, margin: 0,
    });
    s.addText(m[2], {
      x: bx + 3.4, y, w: 1.4, h: 0.4,
      fontFace: F, fontSize: 16, color: INK, align: 'right', margin: 0,
    });
    s.addText(m[3], {
      x: bx + 4.85, y: y + 0.03, w: 1.55, h: 0.34,
      fontFace: F, fontSize: 10, color: m[3] === 'Protected' ? GREEN : DIM_L,
      bold: m[3] === 'Protected', align: 'right', margin: 0, charSpacing: 0.8,
    });
    s.addShape(pres.ShapeType.line, {
      x: bx + 0.4, y: y + 0.5, w: 6, h: 0,
      line: { color: RULE_L, width: 0.75 },
    });
  });

  s.addText('Money is protected milestone by milestone.', {
    x: M, y: 5.95, w: 8, h: 0.4,
    fontFace: F, fontSize: 15, bold: true, color: INK, margin: 0,
  });
  s.addNotes(
    'Funding is per milestone, not per project. The client is never exposed for ' +
    'the full amount, and the receiver knows exactly what is covered.',
  );
}

/* ---------------------------------------------------- 06 the core difference */

{
  const s = darkSlide('Release');
  title(s, 'The money doesn’t move just because someone clicks "Pay."', true);

  const states = ['FUNDED', 'PROTECTED', 'WORK SUBMITTED', 'CLIENT REVIEWS', 'APPROVED', 'RELEASED'];
  states.forEach((t, i) => {
    const y = 2.45 + i * 0.62;
    s.addText(String(i + 1).padStart(2, '0'), {
      x: M, y, w: 0.6, h: 0.4,
      fontFace: F, fontSize: 11, color: RULE_D, bold: true, margin: 0,
    });
    s.addText(t, {
      x: M + 0.75, y, w: 5, h: 0.4,
      fontFace: F, fontSize: 17, bold: true,
      color: i === 5 ? GREEN : PAPER, charSpacing: 1, margin: 0,
    });
    if (i < states.length - 1) {
      s.addShape(pres.ShapeType.line, {
        x: M + 0.22, y: y + 0.42, w: 0, h: 0.18,
        line: { color: RULE_D, width: 1 },
      });
    }
  });

  s.addShape(pres.ShapeType.line, {
    x: 7.15, y: 2.45, w: 0, h: 3.35, line: { color: RULE_D, width: 0.75 },
  });
  s.addText('The payment follows the agreement.', {
    x: 7.75, y: 3.15, w: 4.7, h: 1.1,
    fontFace: F, fontSize: 24, bold: true, color: PAPER, lineSpacing: 31, margin: 0,
  });
  s.addText(
    'A milestone can only move where the state machine allows. Anything else is ' +
    'refused with a reason, not silently permitted.',
    {
      x: 7.75, y: 4.35, w: 4.7, h: 1.1,
      fontFace: F, fontSize: 12.5, color: DIM_D, lineSpacing: 18, margin: 0,
    },
  );
  s.addNotes(
    'The transitions are enforced server-side and covered by tests. Approve is ' +
    'the only path from submitted to released.',
  );
}

/* --------------------------------------------------------- 07 trust score */

{
  const s = lightSlide('Trust Score');
  title(s, 'TrustPay doesn’t just move money. It reads the risk around it.', false, 0.85, 30);

  s.addText('92', {
    x: M - 0.12, y: 2.3, w: 3.1, h: 2.1,
    fontFace: F, fontSize: 120, bold: true, color: INK, margin: 0,
  });
  s.addText('/ 100', {
    x: M + 2.6, y: 3.5, w: 1.5, h: 0.6,
    fontFace: F, fontSize: 24, color: DIM_L, margin: 0,
  });
  s.addText('LOW RISK', {
    x: M, y: 4.45, w: 3.5, h: 0.4,
    fontFace: F, fontSize: 15, bold: true, color: GREEN, charSpacing: 2.5, margin: 0,
  });
  s.addText('Example', {
    x: M, y: 4.9, w: 2, h: 0.3,
    fontFace: F, fontSize: 9, bold: true, color: DIM_L, charSpacing: 1.5, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: 5.6, y: 2.35, w: 0, h: 3.2, line: { color: RULE_L, width: 0.75 },
  });
  s.addText('The score considers', {
    x: 6.2, y: 2.35, w: 6, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 1.5, margin: 0,
  });

  [
    'Transaction history',
    'Payment behaviour',
    'Project clarity',
    'Cancellation patterns',
    'Dispute history',
    'Unusual activity',
  ].forEach((t, i) => {
    s.addText(t, {
      x: 6.2, y: 2.9 + i * 0.44, w: 6, h: 0.35,
      fontFace: F, fontSize: 15, color: INK, margin: 0,
    });
  });

  s.addText(
    'Risk intelligence, not a financial decision. A score never blocks a payment on its own.',
    {
      x: M, y: 6.15, w: 11, h: 0.35,
      fontFace: F, fontSize: 11, color: DIM_L, margin: 0,
    },
  );
  s.addNotes('Say plainly: the score informs the user. It does not gate money.');
}

/* --------------------------------------------------- 08 why the score matters */

{
  const s = lightSlide('Explainability');
  title(s, 'A score is useful only when you can understand it.', false);

  s.addText('TRUST SCORE', {
    x: M, y: 2.45, w: 3, h: 0.3,
    fontFace: F, fontSize: 10, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('92 / 100', {
    x: M, y: 2.75, w: 3.6, h: 0.8,
    fontFace: F, fontSize: 44, bold: true, color: INK, margin: 0,
  });
  s.addText('LOW RISK', {
    x: M, y: 3.6, w: 3, h: 0.35,
    fontFace: F, fontSize: 13, bold: true, color: GREEN, charSpacing: 2, margin: 0,
  });
  s.addText('Confidence  High', {
    x: M, y: 4.15, w: 3.6, h: 0.35,
    fontFace: F, fontSize: 13, color: DIM_L, margin: 0,
  });
  s.addText('Example', {
    x: M, y: 4.55, w: 2, h: 0.3,
    fontFace: F, fontSize: 9, bold: true, color: DIM_L, charSpacing: 1.5, margin: 0,
  });

  s.addText('Why?', {
    x: 5.5, y: 2.45, w: 3, h: 0.4,
    fontFace: F, fontSize: 20, bold: true, color: INK, margin: 0,
  });

  const reasons = [
    ['Clear milestones', '+ 9'],
    ['Consistent payment behaviour', '+ 7'],
    ['No previous disputes', '+ 6'],
    ['Normal transaction pattern', '+ 4'],
  ];
  reasons.forEach((r, i) => {
    const y = 3.1 + i * 0.62;
    s.addText(r[0], {
      x: 5.5, y, w: 5.2, h: 0.4,
      fontFace: F, fontSize: 15, color: INK, margin: 0,
    });
    s.addText(r[1], {
      x: 10.8, y, w: 1.1, h: 0.4,
      fontFace: F, fontSize: 15, bold: true, color: GREEN, align: 'right', margin: 0,
    });
    s.addShape(pres.ShapeType.line, {
      x: 5.5, y: y + 0.45, w: 6.4, h: 0,
      line: { color: RULE_L, width: 0.75 },
    });
  });

  s.addText(
    'Each feature contributes a fixed, inspectable number of points. The reasons are ' +
    'the arithmetic, not a summary written around a score.',
    {
      x: M, y: 6.05, w: 11, h: 0.6,
      fontFace: F, fontSize: 12.5, color: DIM_L, lineSpacing: 17, margin: 0,
    },
  );
  s.addNotes(
    'This is the part evaluators press on. The contribution of every feature is ' +
    'computed exactly, so the explanation cannot disagree with the score.',
  );
}

/* -------------------------------------------------- 09 agreement analysis */

{
  const s = charSlide('Agreement analysis');
  title(s, 'We check the agreement before the money moves.', true);

  s.addText('PROJECT', {
    x: M, y: 2.45, w: 3, h: 0.28,
    fontFace: F, fontSize: 10, bold: true, color: DIM_D, charSpacing: 2, margin: 0,
  });
  s.addText('Website Development', {
    x: M, y: 2.75, w: 5, h: 0.45,
    fontFace: F, fontSize: 19, bold: true, color: PAPER, margin: 0,
  });

  s.addText('MILESTONE 3', {
    x: M, y: 3.5, w: 3, h: 0.28,
    fontFace: F, fontSize: 10, bold: true, color: DIM_D, charSpacing: 2, margin: 0,
  });
  s.addText('"Complete the website."', {
    x: M, y: 3.8, w: 5, h: 0.5,
    fontFace: F, fontSize: 21, color: PAPER, margin: 0,
  });
  s.addText('Example', {
    x: M, y: 4.4, w: 2, h: 0.3,
    fontFace: F, fontSize: 9, bold: true, color: DIM_D, charSpacing: 1.5, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: 6.5, y: 2.45, w: 0, h: 3.2, line: { color: RULE_D, width: 0.75 },
  });

  s.addText('Risk    Medium', {
    x: 7.1, y: 2.45, w: 5, h: 0.4,
    fontFace: F, fontSize: 15, bold: true, color: AMBER, margin: 0,
  });

  s.addText('Issue', {
    x: 7.1, y: 3.1, w: 5, h: 0.28,
    fontFace: F, fontSize: 10, bold: true, color: DIM_D, charSpacing: 2, margin: 0,
  });
  s.addText('"Completion" is not clearly defined.', {
    x: 7.1, y: 3.4, w: 5.3, h: 0.45,
    fontFace: F, fontSize: 15, color: PAPER, margin: 0,
  });

  s.addText('Recommendation', {
    x: 7.1, y: 4.05, w: 5, h: 0.28,
    fontFace: F, fontSize: 10, bold: true, color: DIM_D, charSpacing: 2, margin: 0,
  });
  s.addText('Add measurable acceptance criteria.', {
    x: 7.1, y: 4.35, w: 5.3, h: 0.45,
    fontFace: F, fontSize: 15, color: PAPER, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: M, y: 5.85, w: 4, h: 0, line: { color: PAPER, width: 1.5 },
  });
  s.addText(
    'The goal isn’t to replace the user.\nIt’s to catch unclear conditions early.',
    {
      x: M, y: 6.0, w: 9, h: 0.7,
      fontFace: F, fontSize: 14, bold: true, color: PAPER, lineSpacing: 20, margin: 0,
    },
  );
  s.addNotes(
    'Vague completion criteria are the single most common cause of disputes. ' +
    'Catching them before funding is cheaper than resolving them after.',
  );
}

/* ------------------------------------------------ 10 cancellation protection */

{
  const s = darkSlide('Cancellation');
  title(s, 'Cancellation should not be one-sided.', true);

  vFlow(s, [
    { t: 'SENDER', s: 'Requests cancellation' },
    { t: 'PAYMENT LOCKED', s: 'Nothing moves' },
    { t: 'RECEIVER', s: 'Receives the request' },
    { t: 'OTP VERIFICATION', s: 'Code goes to the receiver only' },
    { t: 'REFUND', s: 'Returned to the client' },
  ], { x: M, y: 2.35, w: 5.2, dark: true, gap: 0.60, size: 14, align: 'left' });

  s.addShape(pres.ShapeType.line, {
    x: 7.0, y: 2.45, w: 0, h: 3.3, line: { color: RULE_D, width: 0.75 },
  });
  s.addText('Only the authenticated receiver can confirm cancellation.', {
    x: 7.6, y: 3.0, w: 4.9, h: 1.4,
    fontFace: F, fontSize: 21, bold: true, color: PAPER, lineSpacing: 28, margin: 0,
  });
  s.addText(
    'The client cannot pull protected funds back on their own. That single rule is ' +
    'what makes funding safe to accept.',
    {
      x: 7.6, y: 4.5, w: 4.9, h: 1.1,
      fontFace: F, fontSize: 12.5, color: DIM_D, lineSpacing: 18, margin: 0,
    },
  );
  s.addNotes(
    'The OTP is bcrypt-hashed, expiring, single-use and attempt-capped, and only ' +
    'the receiver can verify it. Tested both ways.',
  );
}

/* ------------------------------------------------------------- 11 disputes */

{
  const s = lightSlide('Disputes');
  title(s, 'When something goes wrong, both sides get a record.', false);

  s.addText('CLIENT', {
    x: M, y: 2.5, w: 2.4, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('Claim', {
    x: M, y: 2.8, w: 2.4, h: 0.35,
    fontFace: F, fontSize: 15, color: INK, margin: 0,
  });

  s.addText('RECEIVER', {
    x: M + 2.9, y: 2.5, w: 2.4, h: 0.3,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 2, margin: 0,
  });
  s.addText('Claim', {
    x: M + 2.9, y: 2.8, w: 2.4, h: 0.35,
    fontFace: F, fontSize: 15, color: INK, margin: 0,
  });

  // Both claims converge into one record rather than each dangling into space.
  const joinY = 3.34;
  s.addShape(pres.ShapeType.line, {
    x: M + 0.06, y: 3.22, w: 0, h: joinY - 3.22, line: { color: RULE_L, width: 1 },
  });
  s.addShape(pres.ShapeType.line, {
    x: M + 3.0, y: 3.22, w: 0, h: joinY - 3.22, line: { color: RULE_L, width: 1 },
  });
  s.addShape(pres.ShapeType.line, {
    x: M + 0.06, y: joinY, w: 2.94, h: 0, line: { color: RULE_L, width: 1 },
  });
  s.addShape(pres.ShapeType.line, {
    x: M + 0.06, y: joinY, w: 0, h: 0.22,
    line: { color: RULE_L, width: 1, endArrowType: 'triangle' },
  });

  vFlow(s, [
    { t: 'EVIDENCE', s: 'Files and a timeline' },
    { t: 'AI SUMMARY', s: 'What is on file, taking no side' },
    { t: 'ADMIN REVIEW', s: 'A person reads it' },
    { t: 'RESOLUTION', s: 'Release or refund' },
  ], { x: M, y: 3.62, w: 5.3, dark: false, gap: 0.58, size: 14, align: 'left' });

  s.addShape(pres.ShapeType.line, {
    x: 7.2, y: 2.5, w: 0, h: 3.2, line: { color: RULE_L, width: 0.75 },
  });
  s.addText('AI summarises.\nA human makes the final decision.', {
    x: 7.8, y: 3.1, w: 4.7, h: 1.3,
    fontFace: F, fontSize: 21, bold: true, color: INK, lineSpacing: 28, margin: 0,
  });
  s.addText(
    'Funds stay frozen for the whole dispute. Neither side can release or refund ' +
    'while it is open.',
    {
      x: 7.8, y: 4.55, w: 4.7, h: 1, fontFace: F, fontSize: 12.5,
      color: DIM_L, lineSpacing: 18, margin: 0,
    },
  );
  s.addNotes('Automation that decides who was right would be irresponsible here.');
}

/* --------------------------------------------------- 12 product experience */

{
  const s = charSlide('Product');
  title(s, 'One place to see what is happening with your money.', true);

  // Phone
  const px = M + 0.4;
  const py = 2.35;
  s.addShape(pres.ShapeType.roundRect, {
    x: px, y: py, w: 2.75, h: 4.05, rectRadius: 0.18,
    fill: { color: INK }, line: { color: RULE_D, width: 1 },
  });
  s.addText('Wallet', {
    x: px + 0.22, y: py + 0.25, w: 2, h: 0.3,
    fontFace: F, fontSize: 12, bold: true, color: PAPER, margin: 0,
  });
  s.addText('AVAILABLE', {
    x: px + 0.22, y: py + 0.72, w: 2.3, h: 0.24,
    fontFace: F, fontSize: 8, bold: true, color: DIM_D, charSpacing: 1.5, margin: 0,
  });
  s.addText('₹12,400.00', {
    x: px + 0.22, y: py + 0.95, w: 2.3, h: 0.4,
    fontFace: F, fontSize: 20, bold: true, color: PAPER, margin: 0,
  });
  s.addText('PROTECTED', {
    x: px + 0.22, y: py + 1.45, w: 2.3, h: 0.24,
    fontFace: F, fontSize: 8, bold: true, color: DIM_D, charSpacing: 1.5, margin: 0,
  });
  s.addText('₹15,000.00', {
    x: px + 0.22, y: py + 1.68, w: 2.3, h: 0.35,
    fontFace: F, fontSize: 16, bold: true, color: GREEN, margin: 0,
  });
  s.addShape(pres.ShapeType.line, {
    x: px + 0.22, y: py + 2.2, w: 2.3, h: 0, line: { color: RULE_D, width: 0.75 },
  });
  [
    ['Released — UI Design', '+ ₹10,000'],
    ['Protected — Development', '₹15,000'],
    ['Added to wallet', '+ ₹5,000'],
  ].forEach((r, i) => {
    s.addText(r[0], {
      x: px + 0.22, y: py + 2.38 + i * 0.42, w: 1.6, h: 0.3,
      fontFace: F, fontSize: 8.5, color: PAPER, margin: 0,
    });
    s.addText(r[1], {
      x: px + 1.7, y: py + 2.38 + i * 0.42, w: 0.85, h: 0.3,
      fontFace: F, fontSize: 8.5, color: DIM_D, align: 'right', margin: 0,
    });
  });
  s.addText('Example screen', {
    x: px, y: py + 4.15, w: 2.75, h: 0.28,
    fontFace: F, fontSize: 9, color: DIM_D, align: 'center', margin: 0,
  });

  // Right column
  const rx = 5.0;
  s.addShape(pres.ShapeType.line, {
    x: rx - 0.6, y: 2.35, w: 0, h: 3.4, line: { color: RULE_D, width: 0.75 },
  });
  [
    ['Available balance', 'What can be spent or withdrawn right now.'],
    ['Protected funds', 'Committed to a milestone. Not spendable by either side.'],
    ['Active projects', 'Every milestone and the state it is in.'],
    ['Trust Score', 'The standing, with the reasons behind it.'],
    ['Recent activity', 'What moved, when, and why.'],
  ].forEach((r, i) => {
    const y = 2.4 + i * 0.68;
    s.addText(r[0], {
      x: rx, y, w: 7.2, h: 0.32,
      fontFace: F, fontSize: 15, bold: true, color: PAPER, margin: 0,
    });
    s.addText(r[1], {
      x: rx, y: y + 0.3, w: 7.2, h: 0.3,
      fontFace: F, fontSize: 11.5, color: DIM_D, margin: 0,
    });
  });

  s.addText('Balances stay hidden until unlocked with a fingerprint or PIN.', {
    x: rx, y: 5.9, w: 7.2, h: 0.35,
    fontFace: F, fontSize: 12, color: DIM_D, margin: 0,
  });
  s.addNotes('The state of the money is the whole interface.');
}

/* ----------------------------------------------------------- 13 technology */

{
  const s = lightSlide('Technology');
  title(s, 'Built as a real product, not a mockup.', false);

  const layers = [
    ['MOBILE APP', 'React Native · Expo · TypeScript'],
    ['API', 'FastAPI · Python'],
    ['CORE SERVICES', 'Projects · Milestones · Escrow · Payments · Disputes · Notifications'],
    ['DATABASE', 'PostgreSQL · double-entry ledger · Alembic migrations'],
    ['INTELLIGENCE', 'Trust Score · Risk analysis · Agreement analysis · Dispute summary'],
  ];
  layers.forEach((l, i) => {
    const y = 2.4 + i * 0.72;
    s.addText(l[0], {
      x: M, y, w: 2.9, h: 0.34,
      fontFace: F, fontSize: 11, bold: true, color: INK, charSpacing: 1.5, margin: 0,
    });
    s.addText(l[1], {
      x: M + 3.0, y, w: 8.4, h: 0.34,
      fontFace: F, fontSize: 13.5, color: DIM_L, margin: 0,
    });
    s.addShape(pres.ShapeType.line, {
      x: M, y: y + 0.44, w: W, h: 0, line: { color: RULE_L, width: 0.75 },
    });
    if (i < layers.length - 1) {
      s.addShape(pres.ShapeType.line, {
        x: M + 0.5, y: y + 0.46, w: 0, h: 0.24,
        line: { color: RULE_L, width: 1, endArrowType: 'triangle' },
      });
    }
  });

  const stats = [['212', 'automated tests'], ['64', 'API endpoints'], ['23', 'database tables']];
  stats.forEach((st, i) => {
    const x = M + i * 3.9;
    s.addText(st[0], {
      x, y: 6.0, w: 1.3, h: 0.5,
      fontFace: F, fontSize: 28, bold: true, color: INK, margin: 0,
    });
    s.addText(st[1], {
      x: x + 1.35, y: 6.16, w: 2.4, h: 0.35,
      fontFace: F, fontSize: 12, color: DIM_L, margin: 0,
    });
  });
  s.addNotes(
    'Deployed and running, not a local demo. The test count is the real figure ' +
    'from the repository.',
  );
}

/* ------------------------------------------------------------- 14 security */

{
  const s = darkSlide('Security');
  title(s, 'Trust has to exist in the system, not just in the UI.', true);

  const controls = [
    ['Authentication', 'Rotating refresh tokens with reuse detection'],
    ['Role-based access', 'Only the client funds; only the receiver submits'],
    ['OTP verification', 'Cancellation confirmed by the receiver alone'],
    ['Atomic transactions', 'A release either fully happens or does not'],
    ['Idempotency', 'A retried tap cannot pay twice'],
    ['Audit log', 'Every financial action recorded with its actor'],
    ['Rate limiting', 'Brute force on codes and passwords is bounded'],
    ['Double-entry ledger', 'Postings must sum to zero, balances derived from them'],
  ];
  controls.forEach((c, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 6.05;
    const y = 2.35 + row * 0.82;
    s.addText(c[0], {
      x, y, w: 5.6, h: 0.32,
      fontFace: F, fontSize: 14.5, bold: true, color: PAPER, margin: 0,
    });
    s.addText(c[1], {
      x, y: y + 0.3, w: 5.6, h: 0.3,
      fontFace: F, fontSize: 11.5, color: DIM_D, margin: 0,
    });
  });

  s.addShape(pres.ShapeType.line, {
    x: M, y: 6.0, w: 4.2, h: 0, line: { color: PAPER, width: 1.5 },
  });
  s.addText('Every financial action is validated on the server.', {
    x: M, y: 6.15, w: 9, h: 0.4,
    fontFace: F, fontSize: 16, bold: true, color: PAPER, margin: 0,
  });
  s.addNotes(
    'The app is a view. Nothing it sends is trusted; every rule is re-checked ' +
    'server-side.',
  );
}

/* -------------------------------------------------------- 15 why trustpay */

{
  const s = lightSlide('Why TrustPay');
  title(s, 'We are building the trust layer around transactions.', false);

  s.addText('Traditional payment', {
    x: M, y: 2.5, w: 5, h: 0.32,
    fontFace: F, fontSize: 11, bold: true, color: DIM_L, charSpacing: 1.5, margin: 0,
  });
  s.addText('Send    →    Receive', {
    x: M, y: 2.85, w: 5.2, h: 0.5,
    fontFace: F, fontSize: 21, color: DIM_L, margin: 0,
  });

  s.addShape(pres.ShapeType.line, {
    x: M, y: 3.75, w: 11.2, h: 0, line: { color: RULE_L, width: 0.75 },
  });

  s.addText('TrustPay', {
    x: M, y: 4.0, w: 5, h: 0.32,
    fontFace: F, fontSize: 11, bold: true, color: INK, charSpacing: 1.5, margin: 0,
  });
  const chain = ['Agree', 'Define', 'Protect', 'Work', 'Verify', 'Release'];
  chain.forEach((c, i) => {
    const x = M + i * 1.87;
    s.addText(c, {
      x, y: 4.35, w: 1.55, h: 0.45,
      fontFace: F, fontSize: 18, bold: true, color: INK, margin: 0,
    });
    if (i < chain.length - 1) {
      s.addText('→', {
        x: x + 1.42, y: 4.37, w: 0.4, h: 0.4,
        fontFace: F, fontSize: 15, color: DIM_L, margin: 0,
      });
    }
  });

  s.addText('Milestones, protected funds, explainable risk, controlled release.', {
    x: M, y: 5.25, w: 11, h: 0.4,
    fontFace: F, fontSize: 14, color: DIM_L, margin: 0,
  });

  s.addText('TRUST IS THE PRODUCT.', {
    x: M, y: 5.85, w: 11, h: 0.6,
    fontFace: F, fontSize: 30, bold: true, color: INK, charSpacing: 2, margin: 0,
  });
  s.addNotes('Close on this. Everything else follows from it.');
}

/* --------------------------------------------------------------- 16 closing */

{
  const s = pres.addSlide();
  s.background = { color: INK };
  page += 1;

  s.addText('TRUSTPAY', {
    x: M, y: 3.0, w: 9, h: 0.85,
    fontFace: F, fontSize: 46, bold: true, color: PAPER, charSpacing: 5, margin: 0,
  });
  s.addText('Trust. Protected.', {
    x: M, y: 3.9, w: 9, h: 0.45,
    fontFace: F, fontSize: 17, color: DIM_D, charSpacing: 1, margin: 0,
  });
  s.addShape(pres.ShapeType.line, {
    x: M, y: 4.55, w: 2.6, h: 0, line: { color: RULE_D, width: 1 },
  });
  s.addText('Milestone-based payments for the real world.', {
    x: M, y: 4.75, w: 9, h: 0.4,
    fontFace: F, fontSize: 13, color: DIM_D, margin: 0,
  });
}

pres.writeFile({ fileName: path.join(__dirname, 'TrustPay.pptx') }).then((f) => {
  console.log('wrote', f);
});
