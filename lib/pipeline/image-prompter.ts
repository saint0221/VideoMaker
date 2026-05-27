import fs from 'fs';
import { emit } from '../events';
import { writeFile } from '../project';
import { runClaude, runClaudeWithImage, MODEL } from './claude-runner';
import { extractTargetSeconds } from './utils';

const SYSTEM = `당신은 AI 이미지 생성 프롬프트 전문가입니다.
대본(script-final.md)과 씬 설계서(scene-design.md)를 함께 읽고, 두 문서의 내용과 컨셉이 일관되게 반영된 FAL Flux Dev API 최적화 이미지 프롬프트를 작성합니다.

🎯 작업 순서:
1. **대본 먼저 읽기**: 각 씬의 나레이션 내용, 감정 흐름, 이미지 힌트를 파악합니다.
   - 나레이션이 말하는 핵심 개념이 이미지에 시각적으로 드러나야 합니다.
   - 씬의 감정(충격, 경이, 납득 등)이 이미지 분위기와 일치해야 합니다.
   - 대본의 **이미지 힌트** 항목은 최우선 시각 지시입니다 — 씬 설계서와 함께 반드시 반영하세요.
2. **씬 설계서 참조**: 슬롯 구조(-A, -B 등), 구도, 편집 지시를 따릅니다.
3. **프롬프트 작성**: 두 문서에서 추출한 정보를 종합해 일관된 이미지 프롬프트를 생성합니다.

각 씬마다:
1. 씬 번호 추출 (01, 02, 03...)
2. 영문 프롬프트 최적화: 250~350단어의 상세한 시각 묘사 (아래 프롬프트 구성 가이드 참조)
3. 한글 번역 제공
4. 씬에 맞는 구체적인 네거티브 프롬프트 추가
5. 씬에 특정 텍스트가 표시되어야 하면 **텍스트 합성** 블록 추가 (아래 규칙 참조)

📱 세로 영상(9:16) 구도 — CRITICAL:
이 영상은 유튜브 Shorts용 세로 포맷(9:16)입니다. 모든 프롬프트에 반드시 적용:
- "vertical 9:16 portrait format, mobile-first framing" 포함
- 주요 피사체는 프레임 중앙~상단 1/3에 배치 (하단 자막 영역 여백 확보)
- 가로 구도(landscape, wide shot)는 사용하지 말 것 — 세로로 크롭하면 핵심 요소가 잘릴 수 있음
- 인물이 있는 씬: "full body or upper body portrait, centered vertically"
- 배경 씬: "tall narrow composition, vertical symmetry"
- establishing shot이 필요한 경우: "vertical establishing shot, subject centered in tall frame"

📸 프롬프트 구성 가이드 (모든 요소를 영문 프롬프트에 포함):

1. **카메라/렌즈**: 카메라 기종과 렌즈를 구체적으로 명시
   - 예: "shot on Sony A7R IV, 35mm f/1.4 lens", "Canon EOS R5, 85mm portrait lens, shallow depth of field"
   - 역사 장면: "period photograph aesthetic, aged film grain, archival quality"

2. **조명**: 광원과 방향, 분위기를 상세히
   - 예: "golden hour backlight, warm amber rim light", "Rembrandt lighting, deep shadows", "volumetric god rays filtering through dust"
   - 실내: "soft window light from left, fill light on shadow side", "tungsten practical lights, warm orange glow"

3. **화질 부스터**: 모든 프롬프트에 포함
   - "8K UHD, ultra-detailed textures, photorealistic, hyperrealistic, RAW photo, professional photography"

4. **시네마틱 스타일**: 영상미를 높이는 표현
   - "cinematic color grading, anamorphic lens flare, film noir atmosphere"
   - "shot for National Geographic documentary", "BBC documentary style"
   - "tilt-shift effect", "long exposure motion blur" (적절한 씬에만)

5. **구도/앵글**: 세로 포맷에 맞는 촬영 구도
   - "low angle portrait looking up", "straight-on portrait", "overhead vertical shot"
   - "rule of thirds in portrait frame", "centered symmetrical portrait composition"

6. **분위기/감성**: 감정적 임팩트 묘사
   - "ominous and tense atmosphere", "melancholic solitude", "triumphant grandeur"
   - "oppressive silence", "ethereal dreamlike quality"

⚠️ CRITICAL — AI 이미지 모델의 한국어 텍스트 렌더링 불가:
FAL Flux Dev(및 모든 AI 이미지 생성 모델)는 한국어, 중국어, 일본어 등 비라틴 문자를 정확하게 렌더링하지 못합니다.
프롬프트에 한국어 문자열을 넣으면 완전히 다른 글자나 의미 없는 기호로 출력됩니다.
씬 설계서에 특정 한국어 텍스트가 명시되어 있으면 반드시 아래 **텍스트 합성** 블록을 사용하고,
프롬프트 자체에는 해당 텍스트를 절대 넣지 마세요. 대신 배경 비주얼만 묘사하세요.

📌 텍스트 합성 블록 사용 규칙:
- 씬 설계서에 화면에 표시할 특정 텍스트(한국어 포함)가 있으면 반드시 사용
- 순수 타이포그래피 씬(텍스트가 주인공인 씬)은 배경만 프롬프트로 생성하고 텍스트는 합성으로 처리
- 텍스트 없는 순수 비주얼 씬은 블록 생략 가능

📌 텍스트 합성 블록 형식 (각 필드는 선택):
\`\`\`
**텍스트 합성**:
내용: "화면에 표시할 텍스트"
크기: 120px
위치: x=0.5, y=0.5
색상: #FFFFFF
테두리: #000000 4px
폰트: sans-serif
\`\`\`
- 내용: 따옴표 필수. 실제로 이미지에 렌더링될 텍스트 (한국어 가능)
- 크기: 기본 60px. 화면 크기(1920×1080)에 맞게 조정
- 위치: x/y 각각 0~1 비율 (0.5=중앙). 기본 x=0.5, y=0.85
- 색상: 기본 #FFFFFF (텍스트 색)
- 테두리: "색상 두께px" 형식. 기본 #000000 2px
- 폰트: 기본 sans-serif (한국어 폰트 자동 적용됨)

## CHARACTER_ANCHOR (캐릭터 일관성 앵커)
image-prompts.md 맨 위(첫 SCENE 섹션 이전)에 반드시 포함:
- 대본/씬 설계서에서 등장하는 인물의 외형을 영문으로 구체적으로 기술 (나이, 성별, 얼굴 특징, 머리색, 복장 등)
- 인물이 2명 이상이면 각각 "Main character:", "Secondary character:" 등으로 구분
- 인물이 없는 영상(자연/배경/추상)이면 "N/A" 한 줄
- 이 앵커는 모든 씬 프롬프트 앞에 자동 삽입되므로 씬별 프롬프트에서 인물 외형을 반복하지 않아도 됨
- 영문 50~100단어/인물

## STYLE_ANCHOR (시각 스타일 앵커)
CHARACTER_ANCHOR 바로 아래에 반드시 포함:
- 영상 전체의 색감·분위기·시네마틱 스타일을 영문으로 정의 (100~150단어)
- 포함 항목:
  - Color palette: 주조색·보조색·강조색 (예: "desaturated teal shadows, warm amber highlights, muted earth tones")
  - Film grade: 필름 그레인·색수차·비네팅 등 (예: "subtle 35mm film grain, slight chromatic aberration, gentle vignette")
  - Lighting mood: 전체 조명 기조 (예: "high contrast chiaroscuro, motivated side lighting")
  - Visual tone: 전체 분위기 (예: "melancholic and introspective, slightly desaturated")
  - Cinematic reference: 레퍼런스 영화/다큐 스타일 (예: "Terrence Malick golden hour aesthetic", "BBC Planet Earth documentary")
- 이 앵커는 모든 씬에서 일관되게 적용되므로 씬별 프롬프트에서 반복 불필요

출력 형식 (image-prompts.md):
\`\`\`
# 이미지 생성 프롬프트: {토픽}

## CHARACTER_ANCHOR
Main character: Korean male in his early 50s, weathered face with sharp cheekbones, short salt-and-pepper hair neatly combed back, wearing a dark navy joseon-era official robe with gold collar embroidery, calm and authoritative bearing, dignified posture.

## STYLE_ANCHOR
Color palette: desaturated teal and charcoal shadows with warm amber and ochre highlights, occasional deep crimson accent. Film grade: subtle 16mm film grain, slight chromatic aberration at edges, soft vignette. Lighting mood: high contrast chiaroscuro with motivated practical light sources, dramatic side lighting. Visual tone: melancholic and weighty, quiet tension beneath the surface. Cinematic reference: Park Chan-wook dramatic staging meets BBC historical documentary — meticulous period detail with emotionally charged framing.

---

## SCENE 01
**프롬프트 (영문)**:
vertical 9:16 portrait format, mobile-first framing, {최적화된 영문 프롬프트}

**프롬프트 (한글)**:
{위의 한글 번역}

**네거티브**:
blurry, low quality, watermark, text, nsfw, cartoon, anime, horizontal composition, landscape format, wide angle crop

---

## SCENE 02-A
...

## SCENE 02-B (텍스트 합성 예시 — 순수 타이포그래피 씬)
**프롬프트 (영문)**:
vertical 9:16 portrait format, pure deep black background, absolute darkness, cinematic negative space, 4K

**프롬프트 (한글)**:
세로 9:16 포맷, 순수 검정 배경, 절대적 어둠, 시네마틱 네거티브 스페이스, 4K

**네거티브**:
blurry, low quality, watermark, text, nsfw, bright background, any elements, horizontal composition

**텍스트 합성**:
내용: "5분 → 새벽 3시"
크기: 140px
위치: x=0.5, y=0.5
색상: #FFFFFF
테두리: #000000 4px

---
\`\`\`

규칙:
- 모든 씬 빠짐없이 포함
- 한 씬에 이미지가 여러 장이면 반드시 -A, -B, -C 순서로 구분 (예: SCENE 02-A, SCENE 02-B). "CUT 1" 형식 절대 사용 금지
- 이미지가 1장인 씬은 그냥 SCENE 01 (알파벳 붙이지 않음)
- **클립 수 제한**: 총 이미지 슬롯 수(A/B 합산) ≤ floor(목표초 / 5). 씬 설계서에 이미 슬롯이 제한돼 있으면 그대로 따를 것
- 씬 설계서에 명시된 스타일(예: 카툰, 레트로, 3D, 일러스트, flat design 등)을 반드시 그대로 유지할 것 — 절대 다른 스타일로 변경하지 말 것
- 씬 설계서에 스타일 지시가 없는 경우에만 사진 리얼리즘 스타일 기본 적용 (documentary style, cinematic, photorealistic)
- 역사 장면은 "historical photograph aesthetic, period accurate costumes, dramatic chiaroscuro lighting" 포함
- 인물이 등장하면 ethnicity/nationality 명시 (Korean man, Japanese woman 등)
- 네거티브 프롬프트는 씬 특성에 맞게 구체적으로 작성 (일반적인 것 외 씬에 어울리지 않는 요소 추가)
- 모든 씬 네거티브에 "horizontal composition, landscape format, wide angle crop" 포함 (세로 포맷 강제)
- 한국어로 작성 (프롬프트 자체는 영문)
- 프롬프트에 한국어 문자열 절대 포함 금지 — 텍스트가 필요하면 **텍스트 합성** 블록 사용

⚠️ CRITICAL — 오브젝트 방향/구조 명시 규칙:
AI 이미지 모델은 앞뒤가 다른 오브젝트(스마트폰, 노트북, 카메라, 책 등)의 방향을 자주 혼동하여 물리적으로 불가능한 구조를 생성한다.
해당 오브젝트가 등장하는 씬은 반드시 아래 패턴으로 방향을 명시할 것:

- 스마트폰: "smartphone held with touchscreen display facing [toward camera / upward / toward viewer], rear camera module on the back side pressed against the palm"
- 노트북: "laptop screen open and facing viewer, keyboard visible on the near side, hinge at the back"
- 카메라: "camera lens pointing away from subject toward viewer, viewfinder at the back near the eye"
- 책/문서: "document face-up with text surface visible, cover/back side facing downward"
- 기타: 어느 면이 카메라를 향하는지, 반대면에 무엇이 있는지 명시

또한 해당 씬의 네거티브 프롬프트에 반드시 추가:
"screen on back of device, impossible object orientation, anatomically incorrect structure, physically impossible configuration"`;

const ANCHOR_SYSTEM = `당신은 AI 이미지 생성 전문가입니다.
아래 대본과 씬 설계서를 분석하여 image-prompts.md용 CHARACTER_ANCHOR와 STYLE_ANCHOR 두 블록만 출력하세요.

CHARACTER_ANCHOR 규칙:
- 등장하는 모든 인물의 외형을 영문으로 기술 (나이, 성별, 얼굴 특징, 머리색, 복장 등)
- 2명 이상이면 "Main character:", "Secondary character:" 등으로 구분
- 인물이 없는 영상이면 N/A 한 줄
- 영문 50~100단어/인물

STYLE_ANCHOR 규칙:
- 영상 전체 색감·분위기·시네마틱 스타일을 영문으로 정의 (100~150단어)
- 반드시 포함: Color palette, Film grade, Lighting mood, Visual tone, Cinematic reference

출력 형식 — 아래 두 블록만, 그 외 내용은 절대 출력 금지:
## CHARACTER_ANCHOR
{내용}

## STYLE_ANCHOR
{내용}`;

function buildSdxlOverride(): string {
  return `

⚠️ SDXL 모델 전용 — 프롬프트 형식 변경 (최우선 지시):
이 프로젝트는 SDXL 기반 모델로 이미지를 생성합니다. SDXL의 텍스트 인코더 한계(약 77토큰)로 인해 긴 프롬프트는 뒷부분이 잘립니다.

기존 "250~350단어 상세 묘사" 지시를 무시하고 아래 규칙을 따르세요:
1. **길이**: 영문 프롬프트 50~80단어로 제한
2. **형식**: 문장 형식 금지 — 쉼표 구분 키워드 나열만 사용
3. **우선순위**: 핵심 피사체 → 행동/상황 → 배경/설정 → 분위기 키워드 → 품질 태그
4. **생략**: 카메라 기종·렌즈 스펙·긴 조명 묘사·감성 서술 생략
5. **품질 태그** (고정 포함): "high quality, sharp focus, masterpiece, best quality, 4K resolution"

예시 형식:
[트리거워드], [핵심 피사체], [행동/포즈], [배경], [분위기], [스타일 키워드], high quality, sharp focus, masterpiece, best quality, 4K resolution`;
}

function buildLoraOverride(loraTriggerWord: string): string {
  return `

⚠️ LoRA 스타일 적용 (최우선 지시):
이 프로젝트는 "${loraTriggerWord}" LoRA 스타일로 이미지를 생성합니다.
아래 지시를 반드시 준수하세요:
1. **모든 프롬프트 첫 부분에 트리거 워드 포함**: "${loraTriggerWord}" 를 각 프롬프트 맨 앞에 삽입
2. **포토리얼리스틱 카메라 스펙 사용 금지**: Sony A7R IV, Canon EOS R5, 35mm lens 등 실제 카메라 명세 불포함
3. **포토리얼리스틱 화질 부스터 사용 금지**: "photorealistic, hyperrealistic, RAW photo" 태그 불포함
4. **LoRA 스타일에 맞는 시각 언어 사용**: 트리거 워드("${loraTriggerWord}")가 암시하는 아트 스타일로 씬 내용을 재해석
5. **LoRA 스타일에 맞는 품질 태그 사용**: "high quality, sharp focus, masterpiece, best quality" 등 스타일 중립적 품질 태그 적용
6. **STYLE_ANCHOR**: 포토리얼리스틱 시네마틱 스타일 대신 "${loraTriggerWord}" 스타일에 맞는 색감·분위기를 정의하고, 모든 씬에 일관된 LoRA 스타일 적용`;
}

function parseSceneSections(md: string): Array<{ id: string; content: string }> {
  const sections: Array<{ id: string; content: string }> = [];
  const parts = md.split(/(?=^## SCENE \d+)/m);
  for (const part of parts) {
    const match = part.match(/^## SCENE (\d+)/m);
    if (match) {
      sections.push({ id: match[1], content: part.trim() });
    }
  }
  return sections;
}

async function analyzeReferenceImage(imagePath: string): Promise<string | null> {
  return runClaudeWithImage(
    imagePath,
    'Describe this image\'s visual style in English for use as a reference in AI image generation. Focus on: color palette, lighting mood, film grain/texture, overall atmosphere, cinematic style. Be concise (80-120 words). Do not describe the subject matter — only the visual/photographic style.',
    { model: MODEL.HAIKU },
  );
}

export async function runImagePrompter(
  projectId: string,
  topic: string,
  sceneDesignMd: string,
  scriptFinalMd: string,
  referenceImagePath?: string,
  loraTriggerWord?: string,
  imageModel?: string,
): Promise<string> {
  emit(projectId, { type: 'log', message: '[8단계] 이미지 프롬프트 생성 중...' });

  const targetSecs = extractTargetSeconds(topic);
  const maxClips = targetSecs ? Math.floor(targetSecs / 5) : null;
  const durationConstraint = maxClips
    ? `\n⚠️ 목표 길이 ${targetSecs}초 → 총 이미지 슬롯(A/B 합산) 최대 ${maxClips}개. 이를 초과하지 말 것.`
    : '';

  let referenceSection = '';
  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    if (!process.env.ANTHROPIC_API_KEY) {
      emit(projectId, { type: 'log', message: '  ⚠️ ANTHROPIC_API_KEY 미설정 — 레퍼런스 스타일 분석 건너뜀 (이미지 생성 시 img2img로 스타일 반영)' });
    } else {
      emit(projectId, { type: 'log', message: '  🎨 레퍼런스 이미지 스타일 분석 중...' });
      const styleDesc = await analyzeReferenceImage(referenceImagePath);
      if (styleDesc) {
        referenceSection = `\n## 레퍼런스 이미지 스타일 분석\n${styleDesc}\n→ 위 스타일을 STYLE_ANCHOR와 각 씬 프롬프트에 최대한 반영하세요.\n`;
        emit(projectId, { type: 'log', message: '  ✅ 레퍼런스 스타일 분석 완료' });
      } else {
        emit(projectId, { type: 'log', message: '  ⚠️ 레퍼런스 스타일 분석 실패 — 기본 스타일로 프롬프트 생성' });
      }
    }
  }

  const sceneSections = parseSceneSections(sceneDesignMd);

  if (sceneSections.length === 0) {
    throw new Error('씬 설계서에서 씬 섹션을 파싱하지 못했습니다. scene-design.md의 형식을 확인하세요.');
  }

  emit(projectId, { type: 'log', message: `  📋 씬 ${sceneSections.length}개 파싱 — 앵커 생성 후 병렬 처리` });

  // Step 1: anchor call — CHARACTER_ANCHOR + STYLE_ANCHOR only
  const anchorInput = `토픽: "${topic}"
${referenceSection}
## 대본 (script-final.md)
${scriptFinalMd}

## 씬 설계서 (scene-design.md)
${sceneDesignMd}

CHARACTER_ANCHOR와 STYLE_ANCHOR 두 블록만 출력하세요.`;

  const loraOverride = loraTriggerWord?.trim() ? buildLoraOverride(loraTriggerWord.trim()) : '';
  const sdxlOverride = imageModel === 'fal-ai/fast-sdxl' ? buildSdxlOverride() : '';
  const effectiveAnchorSystem = ANCHOR_SYSTEM + loraOverride + sdxlOverride;
  const effectiveSystem = SYSTEM + loraOverride + sdxlOverride;

  emit(projectId, { type: 'log', message: '  🎨 캐릭터·스타일 앵커 생성 중...' });
  const anchorContent = await runClaude(
    `${effectiveAnchorSystem}\n\n---\n\n${anchorInput}`,
    { model: MODEL.SONNET, projectId, timeoutMs: 4 * 60 * 1000 },
  );

  if (!anchorContent) {
    throw new Error('앵커 생성 실패');
  }
  emit(projectId, { type: 'log', message: `  ✅ 앵커 생성 완료 — 씬 ${sceneSections.length}개 병렬 생성 시작` });

  // Step 2: parallel scene calls
  const sceneResults = await Promise.all(
    sceneSections.map(async (scene) => {
      emit(projectId, { type: 'log', message: `  🖼 SCENE ${scene.id} 프롬프트 생성 중...` });

      const result = await runClaude(
        `${effectiveSystem}

⚠️ 이번 호출에서는 아래 지정된 씬 하나만 처리합니다.
- CHARACTER_ANCHOR, STYLE_ANCHOR, 파일 제목 줄(# 이미지 생성 프롬프트: ...) 출력 금지
- 첫 줄은 반드시 "## SCENE ${scene.id}" 또는 "## SCENE ${scene.id}-A"로 시작
- 다른 씬 번호는 출력하지 마세요

---

토픽: "${topic}"${durationConstraint}
${referenceSection}
${anchorContent.trim()}

## 대본 (script-final.md)
${scriptFinalMd}

## 처리할 씬 (scene-design.md 중 SCENE ${scene.id}만):
${scene.content}

이 씬의 이미지 프롬프트 슬롯만 출력하세요.`,
        { model: MODEL.SONNET, projectId, timeoutMs: 8 * 60 * 1000 },
      );

      if (!result || !/##\s+SCENE/i.test(result)) {
        throw new Error(`SCENE ${scene.id} 프롬프트 생성 실패 또는 내용 누락`);
      }

      emit(projectId, { type: 'log', message: `  ✅ SCENE ${scene.id} 완료` });
      return { id: scene.id, content: result };
    }),
  );

  emit(projectId, { type: 'log', message: `  🔀 ${sceneResults.length}개 씬 병합 중...` });

  // Step 3: sort by numeric scene id and merge
  sceneResults.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

  const mergedScenes = sceneResults
    .map(({ content }) => {
      const idx = content.search(/(?:##\s+SCENE|###\s+SLOT)/i);
      return (idx > 0 ? content.slice(idx) : content).trim();
    })
    .join('\n\n---\n\n');

  const finalContent = `# 이미지 생성 프롬프트: ${topic}\n\n${anchorContent.trim()}\n\n---\n\n${mergedScenes}`;

  writeFile(projectId, 'image-prompts.md', finalContent);
  emit(projectId, { type: 'log', message: '✅ image-prompts.md 저장 완료' });

  return finalContent;
}
