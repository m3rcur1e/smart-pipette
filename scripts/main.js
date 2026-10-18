function unlocked(block){
    return block.unlockedNowHost() && block.placeablePlayer && block.environmentBuildable() && block.supportsEnv(Vars.state.rules.env);
}

function usable(b){
    return b.isVisible() && unlocked(b);
}

function attr(attributes, a){
    return attributes == null || a == null ? 0 : attributes.get(a);
}

function extractorsFor(tile){
    const out = [];
    const floor = tile.floor(), wall = tile.block(), overlay = tile.overlay();
    const wallTile = wall != Blocks.air && wall.isStatic();
    const add = test => Vars.content.blocks().each(b => { if(usable(b) && test(b)) out.push(b); });

    if(wallTile){
        const ore = tile.wallDrop();
        if(ore != null){
            add(b => b instanceof BeamDrill && b.tier >= ore.hardness && b.blockedItem != ore &&
                (b.blockedItems == null || !b.blockedItems.contains(ore)));
        }else{
            add(b => b instanceof WallCrafter && attr(wall.attributes, b.attribute) > 0);
        }
        return out;
    }
    if(!wall.alwaysReplace) return out;

    if(floor.allowCorePlacement){
        add(b => b instanceof CoreBlock && coreFits(b, tile));
        if(out.length > 0) return out;
    }
    if(overlay != Blocks.air && overlay.itemDrop != null){
        add(b => b instanceof Drill && b.canMine(tile));
        if(out.length > 0) return out;
    }
    add(b => (b instanceof ThermalGenerator || (b instanceof AttributeCrafter && b.baseEfficiency <= 0)) && attr(floor.attributes, b.attribute) > 0);
    if(out.length > 0) return out;
    if(floor.liquidDrop != null){
        add(b => b instanceof Pump);
        if(out.length > 0) return out;
    }
    if(floor.itemDrop != null) add(b => b instanceof Drill && b.canMine(tile));
    return out;
}

function coreFits(block, tile){
    const s = block.size;
    for(let x0 = tile.x - s + 1; x0 <= tile.x; x0++){
        for(let y0 = tile.y - s + 1; y0 <= tile.y; y0++){
            let ok = true;
            for(let dx = 0; dx < s && ok; dx++){
                for(let dy = 0; dy < s && ok; dy++){
                    let t = Vars.world.tile(x0 + dx, y0 + dy);
                    ok = t != null && t.floor().allowCorePlacement && !(t.block() instanceof CoreBlock) &&
                        (t.build != null || t.block().alwaysReplace);
                }
            }
            if(ok) return true;
        }
    }
    return false;
}

const NEAR = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
function extractorsNear(tile){
    const own = extractorsFor(tile);
    if(own.length > 0) return own;
    for(let i = 0; i < NEAR.length; i++){
        let t = tile.nearby(NEAR[i][0], NEAR[i][1]);
        if(t == null || t.build != null) continue;
        let list = extractorsFor(t);
        if(list.length > 0) return list;
    }
    return own;
}

function nextFor(tile, held){
    if(tile == null || tile.build != null) return null;
    const list = extractorsNear(tile);
    const i = held == null ? -1 : list.indexOf(held);
    if(held != null && i == -1) return null;
    return i + 1 < list.length ? list[i + 1] : null;
}

Events.on(PlacementFragment, req => {
    try{
        req.next = nextFor(req.tile, req.held);
    }catch(e){
        Log.err("[smart-pipette] " + e);
    }
});

function handledByOtherMod(){
    return java.lang.System.getProperty("factorio-tweaks.tool-active") == "1"
        || java.lang.System.getProperty("factorio-tweaks.quickbar-hand") == "1";
}

function smartQOwns(key){
    const m = Vars.mods.getMod("smart-q");
    return key == KeyCode.q && m != null && m.enabled();
}

function planUnderMouse(){
    const pl = Vars.player;
    if(pl.dead()) return false;
    const q = pl.unit().plans;
    for(let i = 0; i < q.size; i++){
        let p = q.get(i);
        if(!p.breaking && p.block != null && p.block.bounds(p.x, p.y, Tmp.r1).contains(Core.input.mouseWorld())) return true;
    }
    return false;
}

function take(inp, block, tile, fresh){
    inp.selectPlans.clear();
    inp.lastSchematic = null;
    inp.block = block;
    if(fresh){
        block.lastConfig = block.getConfig(tile);
        block.onPicked(tile);
    }
    Vars.ui.hudfrag.blockfrag.currentCategory = block.category;
}

function onPick(key){
    const inp = Vars.control.input;
    if(!(inp instanceof DesktopInput) || !Vars.state.isGame() || Vars.state.rules.editor) return;
    if(smartQOwns(key) || handledByOtherMod()) return;
    if(Core.scene.hasKeyboard() || Core.scene.hasDialog() || Core.scene.hasMouse()) return;
    if(Vars.ui.chatfrag.shown() || Vars.ui.consolefrag.shown() || !Vars.player.isBuilder()) return;

    const cursor = Vars.world.tileWorld(Core.input.mouseWorldX(), Core.input.mouseWorldY());
    if(cursor == null || planUnderMouse()) return;

    let held = null, tile = cursor;
    if(inp.block != null && inp.selectPlans.isEmpty()){
        held = inp.block;
    }else if(inp.block == null && inp.selectPlans.size == 1 && !inp.selectPlans.first().breaking){
        const plan = inp.selectPlans.first();
        held = plan.block;
        tile = Vars.world.tile(plan.x, plan.y);
    }
    if(held != null && tile != null && tile.build == null && extractorsNear(tile).indexOf(held) != -1){
        const next = nextFor(tile, held);
        if(next != null){
            take(inp, next, tile, false);
        }else{
            inp.block = null;
            inp.mode = PlaceMode.none;
            inp.selectPlans.clear();
            inp.lastSchematic = null;
        }
        return;
    }

    if(cursor.build != null) return;
    const first = nextFor(cursor, null);
    if(first != null) take(inp, first, cursor, true);
}

function isPick(key){
    return Binding.pick.value != null && key == Binding.pick.value.key && key != KeyCode.unset;
}

Core.input.addProcessor(extend(InputProcessor, {
    keyDown(key){
        try{
            if(isPick(key)) onPick(key);
        }catch(e){
            Log.err("[smart-pipette] " + e);
        }
        return false;
    },
    touchDown(x, y, pointer, button){
        try{
            if(isPick(button)) onPick(button);
        }catch(e){
            Log.err("[smart-pipette] " + e);
        }
        return false;
    }
}));

Log.info("[smart-pipette] loaded");
