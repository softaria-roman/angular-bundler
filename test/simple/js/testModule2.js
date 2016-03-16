'use strict';

angular.module('module2', ['module1']);

angular.module('module2').directive('directive2', function() {});

angular.module('module2').service('service2', service2);

function service2(){}

angular.module('module2').provider('provider2', provider2);

function provider2() {
    this.$get = {};
}