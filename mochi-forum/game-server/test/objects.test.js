const test = require('node:test');
const assert = require('node:assert/strict');
const objects = require('../src/realtime/objects');

function fixture(defKey, hands = { left: null, right: null, active: 'right' }) {
  const player = { userId: 7, x: 0, y: 0, hands };
  const object = {
    id: 12,
    defKey,
    x: 30,
    y: 0,
    vx: 0,
    vy: 0,
    heldBy: null,
    pulledBy: null,
    hand: 'right',
    offX: 1,
    offY: 0,
    dirty: false,
  };
  const room = {
    objects: [object],
    players: new Map([[player.userId, player]]),
    broadcastObjectState() {},
  };
  return { room, player, object };
}

test('dragging an ordinary item assigns one available hand and slows movement', async () => {
  const { room, player, object } = fixture('ball', {
    left: 3,
    right: null,
    active: 'left',
  });

  assert.equal(await objects.pull(room, player, object.id), true);
  assert.equal(object.pulledBy, player.userId);
  assert.equal(object.hand, 'right');
  assert.equal(player.hands.right, object.id);
  assert.equal(player.hands.left, 3);
  assert.equal(objects.movementSpeedMultiplier(room, player), objects.DRAG_SPEED_MULTIPLIER);
});

test('dragging a held item starts from its current position instead of snapping behind the facing', async () => {
  const hands = { left: 12, right: 12, active: 'right' };
  const { room, player, object } = fixture('sledge', hands);
  player.face = Math.PI / 2;
  object.heldBy = player.userId;
  object.hand = 'both';

  assert.equal(await objects.pull(room, player, object.id), true);
  assert.equal(object.heldBy, null);
  assert.equal(object.pulledBy, player.userId);
  assert.equal(object.hand, 'right');
  assert.equal(player.hands.left, null);
  assert.equal(player.hands.right, object.id);
  assert.equal(object.dragX, 1);
  assert.ok(Math.abs(object.dragY) < 1e-9);

  const dragged = new objects.WorldObject({
    id: object.id,
    location_id: 1,
    def_key: object.defKey,
    x: object.x,
    y: object.y,
    pulled_by: player.userId,
  });
  dragged.dragX = object.dragX;
  dragged.dragY = object.dragY;
  room.objects[0] = dragged;
  dragged.step(0.05, room);
  assert.equal(dragged.x, player.x + (22 + objects.radiusOf('sledge') + 12));
});

test('dragging a pull-only object reserves both hands and can be released out of range', async () => {
  const { room, player, object } = fixture('crate');

  assert.equal(await objects.pull(room, player, object.id), true);
  assert.equal(object.hand, 'both');
  assert.equal(player.hands.left, object.id);
  assert.equal(player.hands.right, object.id);

  player.x = 1000;
  assert.equal(await objects.pull(room, player, object.id), true);
  assert.equal(object.pulledBy, null);
  assert.equal(player.hands.left, null);
  assert.equal(player.hands.right, null);
  assert.equal(objects.movementSpeedMultiplier(room, player), 1);
});

test('pull-only objects require both hands to be free', async () => {
  const { room, player, object } = fixture('barrel', {
    left: 5,
    right: null,
    active: 'right',
  });

  assert.match(await objects.pull(room, player, object.id), /свободные руки/);
  assert.equal(object.pulledBy, null);
  assert.equal(player.hands.left, 5);
});

test('switching the active hand returns no chat announcement', async () => {
  const { room, player } = fixture('ball');

  assert.equal(await objects.switchHand(room, player), true);
  assert.equal(player.hands.active, 'left');
});

test('dragged objects stay behind the body regardless of facing and slow movement', async () => {
  const { room, player, object } = fixture('ball');
  const dragged = new objects.WorldObject({
    id: object.id,
    location_id: 1,
    def_key: object.defKey,
    x: object.x,
    y: object.y,
    pulled_by: player.userId,
  });
  room.objects[0] = dragged;
  player.x = 100;
  player.face = Math.PI;
  player.vx = 100;
  player.vy = 0;
  room.players.set(player.userId, player);

  dragged.step(0.05, room);

  assert.equal(dragged.x, player.x - (22 + objects.radiusOf('ball') + 12));
  assert.ok(Math.abs(dragged.y - player.y) < 1e-9);
  assert.equal(objects.movementSpeedMultiplier(room, player), 0.25);
  const state = dragged.toPublic();
  assert.equal(state.dragX, -1);
  assert.ok(Math.abs(state.dragY) < 1e-9);
});
