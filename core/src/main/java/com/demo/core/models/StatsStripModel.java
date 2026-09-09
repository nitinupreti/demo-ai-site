package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class StatsStripModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ChildResource
    private List<StatItemModel> items;

    private List<StatItemModel> filteredItems;

    @PostConstruct
    void init() {
        filteredItems = new ArrayList<>();
        if (items != null) {
            for (StatItemModel it : items) {
                if (it != null && it.isHasContent()) {
                    filteredItems.add(it);
                }
            }
        }
    }

    public List<StatItemModel> getItems() {
        return Collections.unmodifiableList(filteredItems);
    }

    public String getTitle() { return title; }
    public String getDescription() { return description; }

    public boolean isHasContent() {
        return title != null || description != null || !filteredItems.isEmpty();
    }
}
