const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';

const BROKER_ALTERNATIVES = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker-cn.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
];

const MQTT_BROKER_STORAGE_KEY = 'avalon_mqtt_broker';

const MQTTBrokerConfig = {
    defaultBroker: DEFAULT_BROKER,
    alternatives: BROKER_ALTERNATIVES,

    getSelectedBroker() {
        try {
            const saved = localStorage.getItem(MQTT_BROKER_STORAGE_KEY);
            return BROKER_ALTERNATIVES.includes(saved) ? saved : DEFAULT_BROKER;
        } catch (error) {
            return DEFAULT_BROKER;
        }
    },

    setSelectedBroker(brokerUrl) {
        const selected = BROKER_ALTERNATIVES.includes(brokerUrl) ? brokerUrl : DEFAULT_BROKER;
        try {
            localStorage.setItem(MQTT_BROKER_STORAGE_KEY, selected);
        } catch (error) {
            // localStorage may be unavailable in restricted browser contexts.
        }
        return selected;
    },

    getBrokerLabel(brokerUrl) {
        switch (brokerUrl) {
            case 'wss://broker.emqx.io:8084/mqtt':
                return 'EMQX 公共服务器（默认）';
            case 'wss://broker-cn.emqx.io:8084/mqtt':
                return 'EMQX CN 公共服务器';
            case 'wss://broker.hivemq.com:8884/mqtt':
                return 'HiveMQ 公共服务器';
            case 'wss://test.mosquitto.org:8081/mqtt':
                return 'Mosquitto 测试服务器';
            default:
                return brokerUrl;
        }
    }
};

window.DEFAULT_BROKER = DEFAULT_BROKER;
window.BROKER_ALTERNATIVES = BROKER_ALTERNATIVES;
window.MQTTBrokerConfig = MQTTBrokerConfig;
