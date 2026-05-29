import { describe, it, expect, vi } from 'vitest';

// Mock S3 and filesystem side-effects before importing project helpers
vi.mock('../lib/s3', () => ({
  uploadToS3: vi.fn(),
  downloadFromS3: vi.fn(),
  deleteProjectFromS3: vi.fn(),
  s3Enabled: vi.fn(() => false),
}));

// Mock all pipeline runner imports so index.ts loads without heavy transitive deps
vi.mock('../lib/pipeline/researcher', () => ({ runResearcher: vi.fn() }));
vi.mock('../lib/pipeline/youtube-analyzer', () => ({ runYoutubeAnalyzer: vi.fn() }));
vi.mock('../lib/pipeline/strategist', () => ({ runStrategist: vi.fn() }));
vi.mock('../lib/pipeline/planner', () => ({ runPlanner: vi.fn() }));
vi.mock('../lib/pipeline/scriptwriter', () => ({ runScriptwriter: vi.fn() }));
vi.mock('../lib/pipeline/fact-checker', () => ({ runFactChecker: vi.fn() }));
vi.mock('../lib/pipeline/reviewer', () => ({ runReviewer: vi.fn() }));
vi.mock('../lib/pipeline/script-reviser', () => ({ runScriptReviser: vi.fn() }));
vi.mock('../lib/pipeline/tts', () => ({ runTTS: vi.fn() }));
vi.mock('../lib/pipeline/scene-designer', () => ({ runSceneDesigner: vi.fn() }));
vi.mock('../lib/pipeline/image-prompter', () => ({ runImagePrompter: vi.fn() }));
vi.mock('../lib/pipeline/image-generator', () => ({
  runImageGenerator: vi.fn(),
  calcImageCost: vi.fn(() => ({ toGenerate: 0, skipped: 0, costPerUnit: 0.025, totalCost: 0 })),
  SAMPLE_COUNT: 3,
  countScenes: vi.fn(() => 0),
}));
vi.mock('../lib/pipeline/video-generator', () => ({
  runVideoGenerator: vi.fn(),
  calcVideoCost: vi.fn(),
}));
vi.mock('../lib/pipeline/capcut-editor', () => ({ runCapcutEditor: vi.fn() }));
vi.mock('../lib/events', () => ({ emit: vi.fn() }));

import { parseConcepts, parseReviewScore, slugify } from '../lib/project';
import { hasMandatoryRevisions } from '../lib/pipeline/index';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('한국어 공백을 하이픈으로 변환', () => {
    expect(slugify('단종의 죽음 1분 영상')).toBe('단종의-죽음-1분-영상');
  });

  it('앞뒤 공백 제거', () => {
    expect(slugify('  노시보 효과  ')).toBe('노시보-효과');
  });

  it('금지 특수문자를 하이픈으로 치환', () => {
    expect(slugify('제목/부제:설명')).toBe('제목-부제-설명');
    expect(slugify('file*name?test')).toBe('file-name-test');
  });

  it('연속 하이픈을 단일 하이픈으로 축소', () => {
    expect(slugify('a  b   c')).toBe('a-b-c');
    expect(slugify('a//b')).toBe('a-b');
  });

  it('앞뒤 하이픈 제거', () => {
    expect(slugify('-hello-')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// parseReviewScore
// ---------------------------------------------------------------------------

const LEGACY_PASS = `# 대본 검수 결과

## 종합 판정
**점수**: 88/100
**판정**: ✅ 합격`;

const LEGACY_FAIL = `**점수**: 65/100\n**판정**: ❌ 불합격`;

const LEGACY_CONDITIONAL = `**점수**: 73/100\n**판정**: ⚠️ 조건부 합격`;

describe('parseReviewScore', () => {
  describe('legacy 정규식 폴백 (기존 script-review.md 포맷)', () => {
    it('합격 판정 파싱', () => {
      expect(parseReviewScore(LEGACY_PASS)).toEqual({ score: 88, verdict: '합격' });
    });

    it('불합격 판정 파싱', () => {
      expect(parseReviewScore(LEGACY_FAIL)).toEqual({ score: 65, verdict: '불합격' });
    });

    it('조건부 합격 판정 파싱', () => {
      expect(parseReviewScore(LEGACY_CONDITIONAL)).toEqual({ score: 73, verdict: '조건부 합격' });
    });

    it('점수 없는 경우 0 반환', () => {
      const { score } = parseReviewScore('판정만 있고 점수 없음 ✅ 합격');
      expect(score).toBe(0);
    });
  });

  describe('JSON 블록 우선 파싱 (신규 포맷)', () => {
    it('JSON 블록에서 점수·판정 추출', () => {
      const md = LEGACY_PASS + '\n```json\n{"score": 91, "verdict": "합격"}\n```';
      expect(parseReviewScore(md)).toEqual({ score: 91, verdict: '합격' });
    });

    it('JSON이 레거시 정규식보다 우선', () => {
      const md = '**점수**: 70/100\n```json\n{"score": 85, "verdict": "합격"}\n```';
      expect(parseReviewScore(md)).toEqual({ score: 85, verdict: '합격' });
    });

    it('JSON 파싱 실패 시 레거시 폴백', () => {
      const md = LEGACY_PASS + '\n```json\n{broken json\n```';
      expect(parseReviewScore(md)).toEqual({ score: 88, verdict: '합격' });
    });

    it('JSON 필드 타입 불일치 시 레거시 폴백', () => {
      const md = LEGACY_PASS + '\n```json\n{"score": "88", "verdict": "합격"}\n```';
      expect(parseReviewScore(md)).toEqual({ score: 88, verdict: '합격' });
    });
  });
});

// ---------------------------------------------------------------------------
// parseConcepts
// ---------------------------------------------------------------------------

const LEGACY_STRATEGY = `# 콘텐츠 전략: 노시보 효과

> 아래 2-3개 컨셉 중 하나를 선택하세요.

---

## [컨셉 1] 믿으면 아파진다

### 핵심 각도
- 접근 방식: 심리 실험 사례 중심 접근

### CTR 설계
**제목 후보**:
- A: "가짜 약인데 부작용이 생겼다"
- B: "믿었더니 진짜 아팠다"
- C: "노시보 효과의 무서운 진실"

---

## [컨셉 2] 의사도 모르는 부작용의 진짜 원인

### 핵심 각도
- 접근 방식: 반전 정보형 접근

### CTR 설계
**제목 후보**:
- A: "부작용이 약 때문이 아니라고?"
- B: "설명서만 읽어도 아파진다"
`;

describe('parseConcepts', () => {
  describe('legacy 정규식 폴백 (기존 strategy.md 포맷)', () => {
    it('컨셉 2개 정상 파싱', () => {
      const concepts = parseConcepts(LEGACY_STRATEGY);
      expect(concepts).toHaveLength(2);
      expect(concepts[0].index).toBe(1);
      expect(concepts[0].name).toBe('믿으면 아파진다');
      expect(concepts[0].titles).toContain('가짜 약인데 부작용이 생겼다');
      expect(concepts[1].index).toBe(2);
      expect(concepts[1].name).toBe('의사도 모르는 부작용의 진짜 원인');
    });

    it('angle 필드 파싱', () => {
      const [c1] = parseConcepts(LEGACY_STRATEGY);
      expect(c1.angle).toBe('심리 실험 사례 중심 접근');
    });

    it('빈 입력은 빈 배열 반환', () => {
      expect(parseConcepts('')).toHaveLength(0);
    });
  });

  describe('JSON 블록 우선 파싱 (신규 포맷)', () => {
    const JSON_STRATEGY = `# 전략 본문

## [컨셉 1] 레거시 파싱용 섹션

\`\`\`json
[
  {"index": 1, "name": "JSON 컨셉 A", "angle": "각도 A", "titles": ["제목1", "제목2"]},
  {"index": 2, "name": "JSON 컨셉 B", "angle": "각도 B", "titles": ["제목3"]}
]
\`\`\``;

    it('JSON 배열에서 컨셉 추출', () => {
      const concepts = parseConcepts(JSON_STRATEGY);
      expect(concepts).toHaveLength(2);
      expect(concepts[0]).toEqual({ index: 1, name: 'JSON 컨셉 A', angle: '각도 A', titles: ['제목1', '제목2'] });
      expect(concepts[1]).toEqual({ index: 2, name: 'JSON 컨셉 B', angle: '각도 B', titles: ['제목3'] });
    });

    it('JSON이 레거시 정규식보다 우선', () => {
      const concepts = parseConcepts(JSON_STRATEGY);
      // 레거시 파싱이라면 "JSON 컨셉 A"가 아닌 "레거시 파싱용 섹션"이 나와야 함
      expect(concepts[0].name).toBe('JSON 컨셉 A');
    });

    it('JSON 파싱 실패 시 레거시 폴백', () => {
      const broken = LEGACY_STRATEGY + '\n```json\n[{broken}]\n```';
      const concepts = parseConcepts(broken);
      expect(concepts.length).toBeGreaterThan(0);
      expect(concepts[0].name).toBe('믿으면 아파진다');
    });

    it('유효하지 않은 항목(index=0, name 비어있음) 필터링', () => {
      const md = '```json\n[{"index": 0, "name": "", "angle": "", "titles": []}, {"index": 1, "name": "유효", "angle": "", "titles": []}]\n```';
      const concepts = parseConcepts(md);
      expect(concepts).toHaveLength(1);
      expect(concepts[0].name).toBe('유효');
    });
  });
});

// ---------------------------------------------------------------------------
// hasMandatoryRevisions
// ---------------------------------------------------------------------------

describe('hasMandatoryRevisions', () => {
  it('필수 수정 없음("없음") → false', () => {
    const md = '### 🔴 필수 수정\n없음';
    expect(hasMandatoryRevisions(md)).toBe(false);
  });

  it('"해당 없음" → false', () => {
    const md = '### 🔴 필수 수정\n해당 없음';
    expect(hasMandatoryRevisions(md)).toBe(false);
  });

  it('필수 수정 섹션 자체 없음 → false', () => {
    const md = '### 🟡 권장 수정\n뭔가 개선';
    expect(hasMandatoryRevisions(md)).toBe(false);
  });

  it('필수 수정 섹션 비어있음 → false', () => {
    const md = '### 🔴 필수 수정\n\n### 🟡 권장 수정';
    expect(hasMandatoryRevisions(md)).toBe(false);
  });

  it('실제 수정 항목 있음 → true', () => {
    const md = `### 🔴 필수 수정

**[1] 첫 문장 훅 부재**
**현재 대본**: \`"오늘 알아볼 내용은"\`
**수정안 A**: \`"3명 중 1명은 아무 이유 없이 아파집니다."\`
**권장**: 수정안 A`;
    expect(hasMandatoryRevisions(md)).toBe(true);
  });

  it('구분선(---) 무시하고 실제 내용으로 판단', () => {
    const md = '### 🔴 필수 수정\n\n---\n\n없음';
    expect(hasMandatoryRevisions(md)).toBe(false);
  });

  it('수정 항목 여러 개 → true', () => {
    const md = `### 🔴 필수 수정

**[1] 훅 실패**
수정 내용 1

**[2] 분량 초과**
수정 내용 2

### 🟡 권장 수정`;
    expect(hasMandatoryRevisions(md)).toBe(true);
  });
});
