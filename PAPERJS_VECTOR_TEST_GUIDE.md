# Paper.js Vector Generation - Quick Test Guide

## Feature Overview

Users can now generate vector graphics using natural language with Gemini 3 AI, and immediately edit and move the generated shapes.

## Starting the Feature

### Method 1: Auto Mode (Automatic Detection)
1. Open AI Chat Dialog
2. Switch to **Auto** mode
3. Type a vector-related prompt:
   - "画一个蓝色的五角星" (Draw a blue star)
   - "生成一个同心圆图案" (Generate concentric circles)
   - "创建一个spirale" (Create a spiral)
   - "矢量图形：三个颜色不同的圆形" (Vector graphics: three colored circles)

The system automatically detects the intent and routes to Paper.js code generation.

### Method 2: Manual Vector Mode (Explicit Selection)
1. Open AI Chat Dialog
2. Click the **Vector** button (new mode option)
3. Enter your vector design description:
   - Suggested placeholder: "描述你想生成的矢量图形，如：'一个蓝色的五角星' 或 '同心圆图案'..."
   - Example: "Create a geometric pattern with nested squares"

---

## Simple Test Cases

### Test 1: Basic Shape Generation
**Prompt:** "画一个红色的圆形"
**Expected:**
- Red circle rendered in canvas center
- Shape is selectable (can click to select)
- Control points visible when selected
- Can drag control points to modify shape
- Can drag shape body to move it

### Test 2: Multiple Elements
**Prompt:** "绘制三个不同颜色的矩形"
**Expected:**
- Three rectangles render (each should be a separate path item)
- Each rectangle is individually selectable
- Can select all three with marquee selection (click-drag empty area)
- Can drag each rectangle independently

### Test 3: Complex Pattern
**Prompt:** "Create concentric circles: outer circle red, middle blue, inner green. All circles centered in the canvas."
**Expected:**
- Three circles render concentrically
- All circles remain in center of canvas
- Each circle independently editable
- No system movement or repositioning needed

### Test 4: Path with Multiple Segments
**Prompt:** "Draw a wavy line from left to right across the canvas"
**Expected:**
- Wavy line renders
- Multiple control points visible when selected
- Can drag individual points to reshape the curve
- Can drag entire path to move it

---

## Interaction Guide

### Selecting Generated Shapes

**Single Click Selection:**
1. Click on any generated shape
2. Expected feedback:
   - Shape outline becomes thicker (stroke width increases by 1)
   - All control points become visible (white circles at vertices)
   - Shape is added to selection

**Ctrl/Cmd Click (Multi-Select):**
1. Click first shape
2. Hold Ctrl (or Cmd on Mac) and click another shape
3. Expected: Both shapes selected with control points visible

**Marquee Selection:**
1. Click and drag from empty canvas area
2. Drag to create selection rectangle (shown as dashed blue outline)
3. Release to select all shapes within the rectangle
4. Expected: All overlapped shapes selected with control points

**Deselection:**
- Click on empty canvas area to deselect all
- Expected: Strokes return to original width, control points disappear

---

### Moving Generated Shapes

**Move Entire Shape:**
1. Select shape (single click)
2. Position cursor on the shape body (not on a control point)
3. Click and drag
4. Expected:
   - Cursor changes to "move" cursor (↔ symbol)
   - Shape follows cursor smoothly
   - All control points move together
   - Can drop at new location

**Move Individual Control Point:**
1. Select shape (single click)
2. Position cursor directly on a control point (small white circle)
3. Click and drag the point
4. Expected:
   - Cursor changes to "crosshair" (+)
   - Only that point moves
   - Shape deforms in real-time
   - Preserves connections to adjacent points

**Move Multiple Selected Shapes:**
1. Select multiple shapes (Ctrl+Click or Marquee)
2. Click and drag on one of the selected shapes
3. Expected:
   - All selected shapes move together
   - Maintains relative positions
   - All control points update

---

### Editing Generated Shapes

**Modify Shape with Control Points:**
1. Generate a shape (e.g., star or polygon)
2. Click the shape to select it
3. Drag any control point to a new position
4. Expected:
   - Shape smoothly deforms
   - Maintains stroke style (color, width, etc.)
   - Other points don't move

**Property Editing (via Future Updates):**
- Properties panel can edit stroke/fill colors
- Stroke width can be adjusted
- All edits apply to generated shapes just like user-drawn shapes

---

## Progress Indicators

The AI Chat Dialog shows generation progress:

1. **Initial (0%)**: "生成矢量图形中..."
2. **API Response (20%)**: Waiting for Gemini API
3. **Execution Start (60%)**: Code execution beginning
4. **Application (85%)**: Adding shapes to canvas
5. **Complete (100%)**: Success message with shape count

**Success Message Format:**
```
✅ 代码执行完成，共生成 N 个图形
已将 N 个图形应用到当前图层，可直接编辑和移动
```

**Error Message Examples:**
- "请输入要执行的 Paper.js 代码" - Empty code generated
- "画布未初始化，请稍后再试" - Canvas not ready
- "没有可用的画布图层" - No active layer
- Network/API errors from Gemini

---

## Troubleshooting

### Issue: Shape Not Appearing
**Possible Causes:**
1. Canvas not initialized - Wait a moment and try again
2. Code execution error - Check browser console for error details
3. API timeout - System retries 3 times automatically (wait up to 2 minutes)

**Solution:**
- Try simpler shape first: "Draw a circle"
- Check browser console (F12 → Console tab)
- Verify active layer is selected in layer panel

### Issue: Shape Not Selectable
**Possible Causes:**
1. Shape is on wrong layer (should be on active user layer)
2. Shape is a placeholder (shouldn't happen for generated items)

**Solution:**
- Generated shapes should ALWAYS be selectable
- If not selectable, check browser console for errors
- Try reloading the page and regenerating

### Issue: Shape Doesn't Move When Dragged
**Possible Causes:**
1. Cursor not on shape body (try clicking center)
2. Drag distance too small (need at least 3px movement)

**Solution:**
- Ensure shape is selected first (visible control points)
- Click directly on shape (not on empty space)
- Drag at least 3 pixels from starting position

### Issue: Complex Shape Becomes Unstable
**Possible Causes:**
1. Network issue during code generation
2. Code too complex for Gemini to generate reliably

**Solution:**
- System automatically retries 3 times (1-second delays)
- Try breaking complex shapes into smaller ones
- Use simpler, more direct descriptions

---

## Performance Notes

- **Simple shapes** (circle, rectangle, triangle): < 1 second
- **Moderate patterns** (nested shapes, spirals): 2-5 seconds
- **Complex patterns** (many elements, fine details): 5-15 seconds (with retries)

All times include:
- API call to Gemini (500-2000ms)
- Code generation (1000-5000ms)
- Code execution in sandbox (100-500ms)
- Shape copying to active layer (50-200ms)

---

## Advanced Usage

### Combining with Other Tools
- Generate shapes with Vector mode
- Draw additional shapes with drawing tools
- Edit both in the same layer
- All shapes support selection/editing

### Undo/Redo Support
- All generated shape actions are undoable
- Press Ctrl+Z to undo generation
- Press Ctrl+Shift+Z to redo
- Works the same as user-drawn shapes

### Exporting
- Export canvas includes all generated shapes
- Shapes are regular Paper.js items (SVG-compatible)
- Can be saved as image or exported as vector

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Click | Select single shape |
| Ctrl+Click | Add/remove from selection |
| Drag empty area | Marquee select |
| Drag selected shape | Move shape(s) |
| Drag control point | Modify shape |
| Esc | Clear selection |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Delete | Delete selected shape(s) |

---

## Video Walkthrough (Text Description)

1. **Setup**: Open AI Dialog, click Vector mode (or use Auto mode)
2. **Generate**: Type "画一个蓝色的五角星" (blue star)
3. **Watch**: Progress bar fills from 0% to 100% (~2 seconds)
4. **See**: Blue star appears in canvas center
5. **Select**: Click on star → control points appear, stroke thicker
6. **Modify**: Drag top point upward → star stretches
7. **Move**: Drag star body → entire shape moves
8. **Multi-select**: Ctrl+Click on another shape to select both
9. **Done**: All edits preserved, can undo/redo

---

## Expected Behavior Summary

| Action | Expected Result |
|--------|-----------------|
| Generate shape | Appears instantly in center, ≤ 1-5 sec |
| Click shape | Selection highlights, control points show |
| Drag body | Cursor changes to move icon, shape follows |
| Drag point | Cursor changes to crosshair, point moves, shape deforms |
| Marquee select | Rectangle outline shown, all overlapped items selected |
| Press Delete | Selected shapes removed |
| Press Ctrl+Z | Generation undone, shapes removed |
| Press Ctrl+Shift+Z | Generation redone, shapes reappear |

---

## Next Steps (Future Enhancements)

Potential improvements (not yet implemented):
- [ ] Shape property panel (color, stroke, etc.)
- [ ] Layer organization for generated shapes
- [ ] Batch generate multiple shapes in sequence
- [ ] Shape templates (presets)
- [ ] AI shape modification ("make the star bigger")
- [ ] Live preview during code generation
- [ ] Shape export to other formats
