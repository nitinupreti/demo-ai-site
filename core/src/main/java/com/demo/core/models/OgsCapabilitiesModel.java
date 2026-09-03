package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ValueMap;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import com.demo.core.models.ogs.OgsCapabilityTile;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsCapabilitiesModel {

    private final Resource resource;

    @ValueMapValue
    private String heading;

    public OgsCapabilitiesModel(Resource resource) {
        this.resource = resource;
    }

    private List<OgsCapabilityTile> tiles;

    @PostConstruct
    protected void init() {
        List<OgsCapabilityTile> collected = new ArrayList<>();
        Resource root = resource.getChild("tiles");
        if (root != null) {
            for (Resource child : root.getChildren()) {
                ValueMap vm = child.getValueMap();
                collected.add(new OgsCapabilityTile(
                    vm.get("label", ""),
                    vm.get("image", (String) null),
                    vm.get("hoverImage", (String) null)
                ));
            }
        }
        tiles = collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    public String getHeading() {
        return heading;
    }

    public List<OgsCapabilityTile> getTiles() {
        return tiles;
    }
}
