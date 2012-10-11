Physics engine for a 2d world with only circles.

Contains an `Item` class (found in `Physics.Item`) which are the objects of the engine.

Example usage:

```js
new Rect(25,25,250,250,5).fill('yellow').addTo(stage);

// create a new physics engine
var physics = new Physics();

// create one circle every second, shoot it to the board
setInterval(go, 1000);

// cleanup circles. start cleaning up after 10 seconds (10 items).
// clean the oldest at every call.
setTimeout(function(){
    setInterval(function(){
        var x = physics.items.shift().bs.animate('1s',{opacity:0},{onEnd:function(){ x=x.destroy(); }});
    }, 1000);
}, 10000);

// create a new item and add it to the physics engine
function add(x,y,course,speed){
  var group = new Group().attr({x:x,y:y}).addTo(stage);
  new Circle(20,20,20).fill('random').addTo(group);
  var item = new Physics.Item(group, x, y, 20, 1);

  physics.addItem(item);

  // 0 is for curving. we dont use that here, but it's 
  // a value ranged -1 to 1 (-90 to 90 degrees)
  // can only push items that are already added to the engine
  physics.push(item, course, speed, 0);

	// cause the engine to purr (optimization step, it will 
	// set moving to false when the last stone stopped moving)
	physics.moving = true; 
}

// shoot a circle to the board
function go(){
  var x = (Math.round(Math.random())*250) + 25;
  var y = (Math.round(Math.random())*250) + 25;

  var course = Math.random() * (Math.PI/2);
  if (x > 25) course += Math.PI/2;
  if (y > 25) course = -course;

  add(x,y,course,20);
}

// on tick, update position of all items
// (both in engine and visually on screen)
stage.on('tick', function(){
  physics.tick();

  physics.items.forEach(function(item){
    item.bs.attr({x:item.pos.x, y:item.pos.y});
  });
});
```

Live demo: [http://jsfiddle.net/kueMt/]
