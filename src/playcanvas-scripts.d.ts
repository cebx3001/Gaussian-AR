// Type shim for the reveal effect that ships *inside* the pinned `playcanvas`
// package (`playcanvas/scripts/esm/gsplat/reveal-radial.mjs`). It is authored as
// plain ESM with JSDoc and carries no `.d.ts`. This is the upstream
// PlayCanvas / SuperSplat Radial Reveal — consumed as-is, never re-created.
declare module 'playcanvas/scripts/esm/gsplat/reveal-radial.mjs' {
    import { Color, Script, Vec3 } from 'playcanvas';

    export class GSplatRevealRadial extends Script {
        static scriptName: string;
        /** Origin of the radial waves, in the gsplat's LOCAL model space. */
        center: Vec3;
        /** Base wave speed (local units / second). */
        speed: number;
        /** Speed increase over time. */
        acceleration: number;
        /** Delay before the lift wave starts (seconds). */
        delay: number;
        /** Additive colour for the leading dots. */
        dotTint: Color;
        /** Additive colour for the lift-wave highlight. */
        waveTint: Color;
        /** Position oscillation strength. */
        oscillationIntensity: number;
        /** Distance at which the effect stops — must cover the model's extent. */
        endRadius: number;
        /** Colour-band width for the dot and lift waves. */
        bandWidth: number;
        /** True once the lift wave has passed `endRadius`; the effect then disables + reverts itself. */
        isEffectComplete(): boolean;
        /** Seconds from enable until the effect completes. */
        getCompletionTime(): number;
    }
}
