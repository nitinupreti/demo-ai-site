package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ValueMap;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;

import com.demo.core.models.ogs.OgsStatItem;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsStatsModel {

    private final org.apache.sling.api.resource.Resource resource;

    public OgsStatsModel(Resource resource) {
        this.resource = resource;
    }

    private List<OgsStatItem> items;

    @PostConstruct
    protected void init() {
        List<OgsStatItem> collected = new ArrayList<>();
        Resource itemsRoot = resource.getChild("items");
        if (itemsRoot != null) {
            for (Resource child : itemsRoot.getChildren()) {
                ValueMap vm = child.getValueMap();
                collected.add(new OgsStatItem(vm.get("value", ""), vm.get("label", "")));
            }
        }
        items = collected.isEmpty() ? null : Collections.unmodifiableList(collected);
    }

    public List<OgsStatItem> getItems() {
        return items;
    }
}
