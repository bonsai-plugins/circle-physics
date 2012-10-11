// Physics engine for a world of circles
// Each circle in the engine is represented by Item,
// which is exposed through Physics.Item

var Physics = (function(){
  // Some definitions:
  // - course: current direction of movement
  // - bearing: current direction the top of the item is facing

  var config = {
    stepCollisions: false,
    maxSpeed: 40,
    record_shots: false,
    drawCourse: false,
    drawCollisionAngles: false,
    drawCurveCourse: false,
    drawPositionDots: false,
    stopSpeed: 0.01,
    curveAmplifier: 1,
  };

  /**
   * A physics engine for circles that move and collide on a 2d plane.
   *
   * @constructor
   */
  function Physics(){

  }

  Physics.prototype = {
    /**
     * @property {Item[]} items List of items that make up the world view
     */
    items: [],

    /**
     * @property {boolean} lastFinished Used for config.stepCollisions, when false, it wont reset the items. It'll be false if the mode is enabled and there was a collision.
     */
    lastFinished: true,

    /**
     * Add given item to the list of items
     *
     * @param {Item} item
     */
    addItem: function(item){
      if (this.items.indexOf(item) >= 0) console.warn('Item already found!', item);
      else this.items.push(item);
    },
    /**
     * Remove given item from the list of items
     *
     * @param {Item} item
     */
    removeItem: function(item){
      var pos = this.items.indexOf(item);
      if (pos < 0) console.warn("Tried to remove an item that was not found", item);
      else this.items.splice(pos, 1);
    },
    /**
     * Replace the items in the current world view with given items
     *
     * @param arr
     */
    replaceItems: function(arr){
      this.items.length = 0;
      this.items = arr;
    },

    /**
     * Process all items for one time step
     *
     * @return {boolean} Is there any stone still moving?
     */
    tick: function(e){
      if (!config.stepCollisions || this.lastFinished) this.resetItems();

      // check collisions until there are no more chains to break
      // a chain of more than two collisions is pretty unusual
      var loopBreaker = 0; // just in case.
      var collisions = 0;
      do {
        var thisTime = this.collisionStep();

        if (config.stepCollisions && thisTime) {
          this.lastFinished = false;
          return true;
        }

        collisions += thisTime;
      } while (thisTime && ++loopBreaker < 10);
      this.lastFinished = true;

      return this.applyPhysics();
    },
    /**
     * Push one of the stones. All parameters of the shot must be passed on.
     *
     * @param {Item} item
     * @param {number} course (radians)
     * @param {number} speed
     * @param {number} curve (-1 ~ 1)
     */
    push: function(item, course, speed, curve){
      if (speed === 0) return; // ignore

      if (this.items.indexOf(item) < 0) console.warn('Physics engine tried to push an item that it did not know about...');
      speed = Math.min(speed, config.maxSpeed);

      if (config.record_shots) {
        // this makes sure that the shots will be exactly the same as when they are played back (fixes rounding issues)
        var arr = '['+[+item.uid.slice(2), course, speed, curve].join(', ')+','+item.pos.x+','+item.pos.y+']';
        var json = '{"fu":'+arr+'}';
        console.log(arr+',');
        var fu = JSON.parse(json).fu;
        course = fu[1];
        speed = fu[2];
        curve = fu[3];
      }

      // in the future, with special boards, this will be more complex
      var distance = this.distanceToTravel(speed, item.friction);

      if (config.drawCourse) new bonsai.Path()
        .moveTo(item.pos.x+item.radius, item.pos.y+item.radius)
        .lineBy(Math.cos(course) * distance, Math.sin(course) * distance)
        .stroke('red', 2)
        .addTo(item.bs.parent)
        .fadestroy('4s');

      item.speed = speed;

      // adjust the angle to make sure your shot starts towards the original heading
      item.shotCourse = course + (curve * (Math.PI/2));

      // the curve is applied unless it is false
      item.shotCurve = curve;

      // save the start of this stone. we will need that
      // to determine the position of this stone in a curve shot
      item.shotOriginX = item.pos.x;
      item.shotOriginY = item.pos.y;

      // distance traveled over the straight line! (so not the curve)
      // used to determine current position of total distance.
      item.shotTraveled = 0;

      // used to determine progress of the current shot
      item.shotDistance = distance;

//      // there is no initial rotation for a shot.
//      // (we might want to change this for a curved shot)
//      this.rotation = 1;

      // this makes collision detection work for the first step
      item.course = this.getCourseToNextPositionOnCurve(item);
    },
    /**
     * Release anything this object retains
     */
    destroy: function(){
      this.items.length = 0;
      this.items = null;
    },

    /**
     * To prevent unmaintainable system anomalies, each item can only be
     * used once per tick. prevents loops and other nastiness.
     */
    resetItems: function(){
      this.items.forEach(function(item){
        item.unused = 1;
      });
    },
    /**
     * Sweep the system for collisions once. Handle only the first collision
     * we find. Then restart the sweep. This prevents propagation problems.
     */
    collisionStep: function(){
      var collisions = this.items.some(function(item){
        if (item && item.speed && item.unused) {
          var ordered = this.orderByDistance(this.items.slice(0), item);
          // check whether item will collide with any of the other items this step

          for (var i=1;i<ordered.length; ++i) {
            if (ordered[i] && this.updateIfColliding(item, ordered[i])) {
              ++collisions;
              // one collision is enough per step.
              // if it actually collided with a different stone
              // the algorithm will have fixed that by now.
              return true; // break the some
            }
          }
        }
      },this);

      return collisions;
    },
    /**
     * Check if these items will collide this step.
     * If so, update them to prevent that.
     *
     * @param {Item} item1
     * @param {Item} item2
     * @param {number} [_attempt] Internal counter to prevent infinite recursive calls for an even closer stone.
     * @return {boolean} Return true if a collision was prevented
     */
    updateIfColliding: function(item1, item2, _attempt){
      if (!_attempt) _attempt = 1;

      var A = item1.speed >= item2.speed ? item1 : item2;
      var B = A === item1 ? item2 : item1;

      var distanceToCollision = this.getDistanceToIntersection(A, B);

      // if a collision will occur, the distance will be positive
      if (distanceToCollision > 0) {
        var item = this.getClosestItemAfterMove(A, B, distanceToCollision);

        // recursive call to new target (note: A hasnt moved yet)
        if (item !== B && _attempt < 20) this.updateIfColliding(A, item, _attempt+1);
        // otherwise yeah, this is it
        else this.updateForCollision(A, B, distanceToCollision);

        return true;
      }

      return false;
    },
    /**
     * Update various parameters of items A and B because they collided.
     *
     * @param {Item} A
     * @param {Item} B
     * @param {number} distanceToCollisionA
     */
    updateForCollision: function(A, B, distanceToCollisionA){
      var stepDistanceA = this.getStepDistance(A);
      var stepDistanceB = this.getStepDistance(B);

      var distanceToCollisionB = this.getDistanceToIntersection(B, A);

      if (config.drawCollisionAngles) {
        new bonsai.Path()
          .moveTo(A.pos.x+A.radius,A.pos.y+A.radius)
          .lineBy(Math.cos(A.course)*150,Math.sin(A.course)*150)
          .stroke('blue',4)
          .addTo(A.bs.parent)
          .fadestroy('2s','2s');
      }

      A.shotCurve = false;
      B.shotCurve = false;


      var x = A.pos.x;
      var y = A.pos.y;

      // we now move A next to B
      A.setPos(
        A.pos.x + Math.cos(A.course) * distanceToCollisionA,
        A.pos.y + Math.sin(A.course) * distanceToCollisionA
      );
      // update B too
      B.setPos(
        B.pos.x + Math.cos(B.course) * distanceToCollisionB,
        B.pos.y + Math.sin(B.course) * distanceToCollisionB
      );

      if (this.distanceBetween(A,B) < A.radius + B.radius) {
//        console.log('A too close to B now', this.distanceBetween(A,B) , A.radius + B.radius)
        // mul by 0.95 to prevent rounding to cause overlap
        A.setPos(
          x + Math.cos(A.course) * distanceToCollisionA * 0.95,
          y + Math.sin(A.course) * distanceToCollisionA * 0.95
        );
      }

      A.unused *= distanceToCollisionA / stepDistanceA;
      // only update B's unused if it's actually moving... (otherwise unused becomes NaN)
      if (stepDistanceB) B.unused *= distanceToCollisionB / stepDistanceB;

      // determine the line A-B and the (only) tangent exactly between A and B
      var abCourse = this.getCourse(A.pos.x, A.pos.y, B.pos.x, B.pos.y);
      // tangent is exactly half a pi to the left or right
      var tangentCourse = abCourse - (Math.PI/2);

      // the new direction of A is always on the tangent, but which end of it
      // depends on the angle (alpha) A's course makes to abCourse
      var relAngle = this.angleBetween(A.course, abCourse);
      if (relAngle > 0) A.course = tangentCourse;
      else A.course = tangentCourse - Math.PI;

      // abCourse is the course from a line from A towards B. Since A is now
      // touching B, abCourse is also the new course for B.
      B.course = abCourse;

      // update speed of the two stones according to the relAngle and power
      // the angle ranges -1 to 1. the power is 1,2,3.

      // TOFIX: when required, we should also take B's original speed into account

      var F = (A.speed * A.power) / B.power;

      A.speed = A.speed * Math.abs(relAngle);
      B.speed = F * (1-Math.abs(relAngle));
    },
    /**
     * Order the array of items (inline) by distance of each
     * item to given source.
     *
     * @param {Item[]} arr
     * @param {Item} source
     * @return {Array} input
     */
    orderByDistance: function(arr, source){
      // run through all of them, ordered by distance
      // first one to hit will be processed
      // otherwise the algorithm could detect a hit with
      // a stone behind a closer stone and ignore the
      // closer stone. this way, it cant happen. the
      // closer stones are always processed first
      // if they collide, a new check is done after the
      // course is changed for the collision. so the
      // other stones are never skipped, the order just
      // makes things work properly. Though it is a bit
      // expensive :(
      arr.sort(tools.hitch(this, function(a,b) {
        var pa = this.distanceBetween(source, a);
        var pb = this.distanceBetween(source, b);
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return 0;
      }));

      return arr;
    },
    /**
     * Determines the closest item after A moves a given distance forward. This is usually B
     * as the algorithm was trying to move A closer to B. But sometimes another stone might
     * still be closer to A. We're fixing that with this check.
     * We need B too to make sure we're not just returning B without checking the rest.
     *
     * @param {Item} A
     * @param {Item} B
     * @param {number} distance
     * @return {Item} Returns the closest item to A after A moves distance. In most cases, that's B.
     */
    getClosestItemAfterMove: function(A, B, distance){
      var warpAx = A.pos.x + A.radius + (Math.cos(A.course) * distance);
      var warpAy = A.pos.y + A.radius + (Math.sin(A.course) * distance);

      // the distance between A and B must then be both radius combined
      var distanceToB = A.radius + B.radius;
      var closest = B;
      // make sure B is, at that point, the closest item..
      this.items.some(function(item){
        if (item !== A && item !== B) {
          var distanceToItem = this.abcSquare(warpAx-(item.pos.x+item.radius), warpAy-(item.pos.y+item.radius));
          if (distanceToItem < distanceToB) {
            closest = item;
            return true;
          }
        }
      },this);

      return closest;
    },
    /**
     * Apply speed and gravity to every item. Return whether any stone is still moving.
     */
    applyPhysics: function(){
      var movingStones = false;

      this.items.forEach(function(item){
        if (item.speed && item.unused) {

          if (item.shotCurve !== false) {
            var obj = this.getNextCurvePos(item);
            item.setPos(obj.x, obj.y);

//            new Circle(obj.x,obj.y,2).fill('black').addTo(stage);

          } else {
            item.setPos(
              item.pos.x + Math.cos(item.course) * item.speed * item.unused,
              item.pos.y + Math.sin(item.course) * item.speed * item.unused
            );
          }

          item.shotTraveled += item.speed;

          // update course AFTER updating shotTraveled (if still in initial curve shot)
          if (item.shotCurve !== false) {
            item.course = this.getCourseToNextPositionOnCurve(item);
          }

          if (config.drawCurveCourse) {
            var pos = this.getNextPos(item);
            new bonsai.Path()
              .moveTo(item.pos.x+item.radius, item.pos.y+item.radius)
              .lineTo(pos.x+item.radius,pos.y+item.radius)
              .stroke('yellow', 1)
              .addTo(item.bs.parent)
              .fadestroy('2s','3s');
          }

          if (config.drawPositionDots) {
            new bonsai.Circle(item.pos.x+item.radius-2, item.pos.y+item.radius-2, 2)
              .fill('red')
              .addTo(item.bs.parent)
              .fadestroy('4s');
          }

          item.speed *= item.friction;
          if (item.speed < config.stopSpeed) item.speed = 0;

          item.unused = 0; // reset
        }

        if (item.speed) movingStones = true;
      },this);

      return movingStones;
    },
    /**
     * For debugging, check if any item overlaps with another item.
     * If that's true, the system failed.
     */
    collisionCheck: function(){
      // stop game if the game detects two overlapping stones
      // (this will be the case if their centers are less then
      // the radius of both combined away from each other)
      this.items.some(function(A,i){
        if (!A.disabled) for (var j=i+1; j<this.items.length; ++j) {
          var B = this.items[j];
          if (this.abcSquare(A.pos.x-B.pos.x, A.pos.y-B.pos.y) < A.radius+B.radius) {

            // this ought to push two stones away from each other
            // a bit rude and quite a hack, but better than nothing

            // determine the line A-B and the (only) tangent exactly between A and B
            var abCourse = this.getCourse(A.pos.x, A.pos.y, B.pos.x, B.pos.y);
            // tangent is exactly half a pi to the left or right
            var tangentCourse = abCourse - (Math.PI/2);

            var relAngle = this.angleBetween(A.course, abCourse);
            if (relAngle > 0) A.course = tangentCourse;
            else A.course = tangentCourse - Math.PI;
            B.course = abCourse;

            console.warn("Phased :(", this.abcSquare(A.pos.x-B.pos.x, A.pos.y-B.pos.y) , A.radius+B.radius);
            return true;
          }
        }
      },this);
    },

    // ### item math ###

    /**
     * Get the distance this item would travel this step if
     * the current parameters would not change.
     *
     * @param {Item} item
     * @return {number}
     */
    getStepDistance: function(item){
      if (item.cache.stepDistance) return item.cache.stepDistance;

      var stepDistance = item.speed;

      if (item.shotCurve !== false) {
        // distance is slightly more complex. luckily we already have to
        // do most of that math anyways :)
        var newpos = this.getNextCurvePos(item);
        stepDistance = this.abcSquare(newpos.x - item.pos.x, newpos.y - item.pos.y);
      }

      return item.cache.stepDistance = stepDistance * item.unused;
    },
    /**
     * Get the next position of an item as if it were following a curve.
     *
     * @param {Item} item
     * @return {Object} {x:number,y:number}
     */
    getNextCurvePos: function(item){
      if (item.cache.nextCurvePos) return item.cache.nextCurvePos;

      // percentage of 90 degrees (not an angle or anything) at which we shot
      // we use this number to cut down the y below (with that, the curve)
      var curve = item.shotCurve;
      // we will make the stone follow a "perfect" sine :)
      // to get the current position we first need to get
      // x, which is the current progress from origin to end.
      var x = this.getShotProgressToPi(item);

      // now get the height of the sine wave, or part of it anyways
      // if you did not set a curve, curve will be 0
      // if you maxed the curve, curve will be 1
      // we multiply y to create a bigger curve

      var y = Math.sin(x) * curve * config.curveAmplifier;
      // now we get the angle that a line from the origin to the
      // target position on the sine wave would make. we need that.

      var alpha = Math.atan(y/x);
      // to compute the real distance properly we first need the real y
      var realY = (y/Math.PI) * item.shotDistance;
      // now we can simply get the distance between xy1 and xy2
      var curveStepDistance = this.abcSquare(item.shotTraveled+item.speed, realY);

      return item.cache.nextCurvePos = {
        x: item.shotOriginX + (Math.cos(item.shotCourse - alpha) * curveStepDistance),
        y: item.shotOriginY + (Math.sin(item.shotCourse - alpha) * curveStepDistance)
      };
    },
    /**
     * Get the next position of given item
     *
     * @param {Item} item
     * @return {Object} {x:y}
     */
    getNextPos: function(item){
      if (item.cache.nextPos) return item.cache.nextPos;

      if (item.shotCurve === false) {
        return item.cache.nextPos = {x:item.pos.x+Math.cos(item.course)*item.speed, y:item.pos.y+Math.sin(item.course)*item.speed};
      } else {
        return item.cache.nextPos = this.getNextCurvePos(item);
      }
    },
    /**
     * Get the progress of the current shot, normalized between 0 and pi.
     *
     * @return {number}
     */
    getShotProgressToPi: function(item){
      return ((item.shotTraveled+item.speed) / item.shotDistance) * Math.PI;
    },
    /**
     * Without changing anything, determine the course of the stone after this step.
     *
     * @param {Item} item
     * @return {number} radians!
     */
    getCourseToNextPositionOnCurve: function(item){
      var pos = this.getNextPos(item);
      var newCourse = this.getCourse(item.pos.x+item.radius, item.pos.y+item.radius,pos.x+item.radius,pos.y+item.radius);
      return newCourse;
    },

    // ### util math ###

    /**
     * Pythagorean theorem. Returns c=sqrt(a^2,b^2)
     *
     * @param {number} a
     * @param {number} b
     * @return {number}
     */
    abcSquare: function(a, b){
      return Math.abs(Math.pow(Math.pow(a, 2) + Math.pow(b, 2), 0.5));
    },
    /**
     * Return the distance between the center of two items, a and b.
     *
     * @param a
     * @param b
     */
    distanceBetween: function(a,b){
      return this.abcSquare((a.pos.x+a.radius)-(b.pos.x+b.radius), (a.pos.y+a.radius)-(b.pos.y+b.radius));
    },
    /**
     * Assuming circle A is moving in a straight line, get the exact distance
     * at which point it collides with (assumed) stationary circle B, or -1
     * if that won't happen this step.
     * Note: this function assumes A and B don't already overlap.
     *
     * @param {Item} A
     * @param {Item} B
     * @return {number} distance forward when A collides to B, or -1 if that wont happen this step
     */
    getDistanceToIntersection: function(A, B){
      var stepDistanceA = this.getStepDistance(A);
      var stepDistanceB = this.getStepDistance(B);

      var combinedRadius = A.radius + B.radius;

      var acx = A.pos.x + A.radius;
      var acy = A.pos.y + A.radius;
      var bcx = B.pos.x + B.radius;
      var bcy = B.pos.y + B.radius;

//new Path().moveTo(A.pos.x,A.pos.y).lineTo(B.pos.x,B.pos.y).stroke('random', 10).addTo(stage);

      // we draw a line from A to AA
      var aacx = acx + (Math.cos(A.course) * stepDistanceA);
      var aacy = acy + (Math.sin(A.course) * stepDistanceA);

      // also draw a line from B to BB
      var bbcx = bcx + (Math.cos(B.course) * stepDistanceB);
      var bbcy = bcy + (Math.sin(B.course) * stepDistanceB);
//console.log(aacx,bbcx, A.course, stepDistanceA)

//new Path().moveTo(aacx,aacy).lineTo(bbcx,bbcy).stroke('random', 10).addTo(stage);

      // A and B are possibly both moving. change movement vector A
      // as so that B seems stationary. result will still be a normalized
      // number, relative to the original distance, so easy fix.
      // http://www.gamasutra.com/view/feature/131424/pool_hall_lessons_fast_accurate_.php?page=2
      // http://jsfiddle.net/68Rts/
      var dx = (aacx-acx) - (bbcx-bcx);
      var dy = (aacy-acy) - (bbcy-bcy);

      // delta A-B
      var fx = acx - bcx;
      var fy = acy - bcy;
//console.log(dx,fx)
      // We will determine the intersection of the line A-AA with B with this algorithm:
      // http://stackoverflow.com/questions/1073336/circle-line-collision-detection
      // http://mathworld.wolfram.com/Circle-LineIntersection.html

      var a = (dx*dx+dy*dy);
      var b = 2 * (fx*dx+fy*dy);
      var c = (fx*fx+fy*fy) - (combinedRadius*combinedRadius);
      var discriminant = (b*b)-(4*a*c);

      // if discriminant = <0, there are no intersections of B on A-AA
      // else if discriminant = 0, there is just one intersection of B on A-AA
      // else A-AA enters and exits B
      // we will only want to work with the last
      // when A and B just touch each others at the edge, the discriminant will also be zero
      if (discriminant <= 0) return -1;

      // get t1 and t2 to determine where on A-AA the collisions occur
      discriminant = Math.pow(discriminant, 0.5);
      var t1 = (-b + discriminant) / (2*a);
      var t2 = (-b - discriminant) / (2*a);
//console.log(t1,t2, A.radius+ B.radius,~~this.distanceBetween(A,B),this.distanceBetween(A,B)< A.radius+ B.radius)

      // t1 and t2 are normalized numbers relative to A-AA which indicate
      // where on that line the collisions occur. The value 0 is point A
      // where the value 1 is point AA. That means that if t1 or t2 are not
      // withing the 0~1 range, the collisions are not happening on A-AA.
      if ((t1 < 0 || t1 > 1) && (t2 < 0 || t2 > 1)) return -1;

      // we're looking for the nearest collision here...
      var t = t1 < t2 && t1 >= 0 ? t1 : t2;

      var distance = t * stepDistanceA;
      return distance;
    },
    /**
     * Return the course of a line from point 1 to point 2
     *
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @return {number} radians!
     */
    getCourse: function (x1,y1,x2,y2) {
      return Math.atan2((y2-y1), (x2-x1)); // get course in radians
    },
    /**
     * Return the angle between two angles
     *
     * @param {number} A radians!
     * @param {number} B radians!
     * @return {number} between -1 and 1, -1 means -90 degrees, 1 means 90 degrees
     */
    angleBetween: function(A,B){
      return Math.cos((A-B)+(Math.PI/2));
    },
    /**
     * Given initial speed, friction, and a stopping condition (see config
     * for the latter two), determine the total distance that would be made
     * on a straight line.
     *
     * @param {number} speed
     * @param {number} friction
     * @return {number}
     */
    distanceToTravel: function(speed, friction){
      // sum = speed*(1-friction^(x+1)) / 1-friction
      // log(friction^x) = log(config.stopSpeed/speed)
      // x * log(friction) = log(config.stopSpeed/speed)
      // x = log(config.stopSpeed/speed) / log(friction)

      if (speed == 0) return 0;

      // and this we can do :)
      var x = Math.log(config.stopSpeed/speed) / Math.log(friction);

      // now sum it up:
      return (speed*(1-Math.pow(friction, x+1))) / (1-friction);
    },
    /**
     * Determine xy of intersection between two 2d lines A-AA and B-BB
     *
     * @param {number} ax
     * @param {number} ay
     * @param {number} aax
     * @param {number} aay
     * @param {number} bx
     * @param {number} by
     * @param {number} bbx
     * @param {number} bby
     * @return {Object} Returns {x:number,y:number} or null if not intersecting
     */
    lineIntersection: function(ax, ay, aax, aay, bx, by, bbx, bby){
      // http://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect#answer-1968345
      // my demo: http://jsfiddle.net/m7t6y/
      var sax = aax - ax;
      var say = aay - ay;
      var sbx = bbx - bx;
      var sby = bby - by;

      var s = (-say * (ax - bx) + sax * (ay - by)) / (-sbx * say + sax * sby);
      var t = ( sbx * (ay - by) - sby * (ax - bx)) / (-sbx * say + sax * sby);

      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        var x = ax + (t*sax);
        var y = ay + (t*say);

        return {x:x, y:y};
      }

      return null;
    },
  };

  var Item = (function(){

    /**
     * Abstract interface class for the physics engine.
     * Defines some properties used by the engine.
     *
     * @constructor
     * @param {Object} bs The bonsai object that represents this circle
     * @param x
     * @param y
     * @param radius
     * @param power
     */
    function Item(bs,x,y, radius,power){
      this.bs = bs;
      this.pos = {x:x,y:y};
      this.radius = radius;
      this.power = power;
      this.cache = {};
    }
    Item.prototype = {
      // the shot* variables are only used while the stone has not collided yet
      // in code, all the shot variables are ignored when shotCurve === false

      bs: null, // bonsai element
      cache: null, // computational cache

      shotCourse: 0, // straight course in which this stone was released
      shotCurve: false, // -1 ~ 1, shot curve modifier
      shotOriginX: 0,
      shotOriginY: 0,
      shotDistance: 0, // distance of current shot if not colliding
      shotTraveled: 0, // distance traveled in current shot

      pos: null, // {x,y}
      speed: 0,
      course: 0, // in which direction are we moving?
      radius: 0,
      bearing: 0, // current direction of the top of the stone. the stone's rotation affects this value.
      rotation: 0, // amount of spin per tick, subject to the item's friction (or something)
      disabled: false, // cant be used
      ghost: false, // ignored in collision detection system
      unused: -1, // amount of movement left in current step
      friction: 0.9, // slowdown factor

      setPos: function(x,y){
        this.pos.x = x;
        this.pos.y = y;

        for (var key in this.cache) delete this.cache[key];
      }, // updates this.pos

    };

    return Item;

  })();

  Physics.Item = Item;

  return Physics;
})();
