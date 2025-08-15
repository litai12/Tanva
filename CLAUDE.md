# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Artboard is a professional React + TypeScript drawing application based on Paper.js. This is a refactored project migrating from the my-app codebase, focusing on clean architecture and production-ready implementation.

**Migration Context**: This project is being refactored from `../my-app`, leveraging proven patterns and components to accelerate development while maintaining high code quality.

**Architecture Philosophy**: Build a production-grade drawing application with proper separation of concerns, optimal performance, and extensible design patterns.

## Development Commands

### Primary Commands
- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm run lint` - ESLint code quality check
- `npm run preview` - Preview production build

### Code Quality Requirements
- **TypeScript strict mode** - All code must pass strict type checking
- **ESLint compliance** - Code must pass linting without warnings
- **Production readiness** - Code should be optimized for performance and maintainability

## Architecture Guidelines

### State Management - Zustand
```typescript
// Use Zustand stores in src/stores/ directory
- canvasStore.ts - Canvas state (zoom, pan, grid settings)
- appStore.ts - Application state
- uiStore.ts - UI panel visibility and settings
```

**Pattern**: Follow the established store patterns from my-app, ensuring clean separation and TypeScript typing.

### Component Structure
```
src/
├── components/
│   ├── canvas/          # Canvas-specific components
│   ├── layout/          # Layout components
│   └── ui/              # Reusable UI components (shadcn/ui)
├── pages/               # Page components
├── stores/              # Zustand state management
├── lib/                 # Utility functions
└── types/               # TypeScript type definitions
```

### Canvas System (CRITICAL MONITORING)

**Canvas.tsx Line Count Monitoring**: Current: 49 lines
- ⚠️ **KEEP UNDER 100 LINES** - Split into components when approaching this limit
- Extract complex logic into custom hooks
- Move Paper.js specific code to dedicated services/utilities
- Create specialized canvas components for different features

**Component Extraction Strategy**:
1. **When Canvas.tsx > 80 lines**: Start planning component extraction
2. **When Canvas.tsx > 100 lines**: IMMEDIATELY extract components
3. **Target components to extract**:
   - Grid rendering logic → `GridRenderer.tsx`
   - Interaction handling → `InteractionController.tsx`
   - Canvas initialization → `CanvasProvider.tsx`
   - Tool-specific logic → `ToolController.tsx`

## Migration Guidelines from my-app

### Reusable Patterns to Leverage
1. **Canvas State Management**: Adapt the proven canvas state patterns from my-app
2. **UI Components**: Reuse shadcn/ui components and layouts
3. **Service Architecture**: Adopt the service layer pattern for business logic
4. **Hook Patterns**: Utilize established custom hooks for state management

### Code Reuse Strategy
- **Direct Migration**: Copy proven utility functions and helper classes
- **Adapted Migration**: Modify my-app components to fit artboard's simpler scope
- **Reference Implementation**: Use my-app as a reference for complex interactions

### What NOT to Migrate
- Backend-specific code (NestJS, authentication, database)
- 3D model systems (unless specifically needed)
- Complex AI integration (unless required for artboard features)
- Over-engineered patterns that don't fit artboard's scope

## Production Quality Requirements

### Performance Standards
- **Canvas Operations**: Maintain 60fps during interactions
- **Component Rendering**: Minimize unnecessary re-renders
- **Memory Management**: Proper cleanup of Paper.js objects and event listeners
- **Bundle Size**: Keep optimized for fast loading

### Code Quality Standards
- **Type Safety**: All components must have proper TypeScript types
- **Error Handling**: Graceful error handling for all user interactions
- **Documentation**: Critical functions must have JSDoc comments
- **Testing**: Unit tests for core utilities and hooks

### Potential Issues to Monitor

#### 1. Canvas Performance
- Monitor Paper.js object creation and cleanup
- Watch for memory leaks in event listeners
- Ensure proper useEffect cleanup

#### 2. State Management Complexity
- Keep Zustand stores focused and single-purpose
- Avoid circular dependencies between stores
- Monitor for state update performance issues

#### 3. Component Coupling
- Maintain loose coupling between canvas and UI components
- Ensure components are testable in isolation
- Watch for prop drilling anti-patterns

#### 4. Paper.js Integration
- Proper lifecycle management of Paper.js objects
- Coordinate system consistency
- Event handling conflicts between React and Paper.js

## Key Technical Decisions

### Canvas System
- **Paper.js Integration**: Use Paper.js for professional 2D graphics capabilities
- **Coordinate System**: Maintain consistent coordinate mapping between DOM and Paper.js
- **Event Handling**: Careful separation of React and Paper.js event systems

### UI Framework
- **shadcn/ui**: Use for consistent, accessible UI components
- **Tailwind CSS**: Utility-first styling approach
- **Responsive Design**: Mobile-first responsive design principles

### Development Workflow
- **Hot Reload**: Maintain fast development feedback loop
- **Type Checking**: Real-time TypeScript error detection
- **Code Quality**: Pre-commit hooks for linting and formatting

## Path Aliases
- `@/*` maps to `./src/*` - use for all internal imports

## File Organization Principles

### Component Files
- One component per file
- Co-locate related types in the same file
- Use descriptive, specific file names

### Store Files
- Single responsibility per store
- Clear separation of concerns
- Proper TypeScript typing for all state

### Utility Files
- Pure functions where possible
- Clear input/output typing
- Comprehensive error handling

## Integration Points with my-app

### Shared Patterns
- Zustand store architecture
- shadcn/ui component usage
- TypeScript configuration
- Build tool configuration (Vite)

### Reference Components
- Use my-app's proven UI components as templates
- Adapt interaction patterns for artboard's needs
- Leverage established utility functions

### Performance Lessons
- Apply performance optimizations learned from my-app
- Use proven patterns for Paper.js integration
- Implement tested approaches for state management

---

**Maintenance Priority**: Keep Canvas.tsx lean and focused. This is the heart of the application and must remain maintainable.

**Development Philosophy**: Production-ready code from day one. Every commit should maintain deployable quality.

**Migration Strategy**: Leverage my-app's proven patterns while keeping artboard focused and lightweight.