import Store from 'fluxible/addons/BaseStore';

class DestinationStore extends Store {
  static storeName = 'DestinationStore';

  getDestination() {
    return this.destination;
  }

  setDestination(destination) {
    this.destination = destination;
    this.emitChange();
  }

  static handlers = {
    SetDestination: 'setDestination',
  };
}

export default DestinationStore;
